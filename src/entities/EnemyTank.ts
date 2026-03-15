import { Tank } from './Tank';
import { TankGrade, TankFaction, Direction, EnemyBehavior } from '../types';
import { GameManager } from '../engine/GameManager';
import { CELL_SIZE, GRID_COLS, GRID_ROWS, BATTLE_AREA_X, BATTLE_AREA_Y } from '../constants';
import { AStarPathfinder } from '../systems/AStarPathfinder';

export enum EnemyStrategy {
    BASE = 'BASE',
    PLAYER = 'PLAYER',
    POWERUP = 'POWERUP',
    WANDER = 'WANDER'
}

export class EnemyTank extends Tank {
    private spawnTimer: number = 60;
    public hasSpawned: boolean = false;

    // AI State
    private stuckFrames: number = 0;
    private lastX: number = 0;
    private lastY: number = 0;
    private positionQuietFrames: number = 0;
    private waitFrames: number = 0;

    public holdsPowerUp: boolean = false;
    private flashTimer: number = 0;
    private hitFlashActive: boolean = false;

    // Advanced AI
    public behavior: EnemyBehavior = EnemyBehavior.ATTACK;
    private pathfinder: AStarPathfinder;
    private currentPath: Direction[] = [];
    private pathRefreshTimer: number = 0;

    // Grid Alignment Tracking
    private lastProcessedCol: number = -1;
    private lastProcessedRow: number = -1;

    // Strategy Commitment
    private currentStrategy: EnemyStrategy = EnemyStrategy.BASE;
    private strategyTimer: number = 0;

    // Debug Visualization
    private debugPathPoints: {x: number, y: number}[] = [];
    private debugColor: string = '#ffff00';

    constructor(gameManager: GameManager, x: number, y: number, grade: TankGrade, holdsPowerUp: boolean = false, behavior: EnemyBehavior = EnemyBehavior.ATTACK) {
        super(gameManager);
        this.x = x * CELL_SIZE;
        this.y = y * CELL_SIZE;
        this.lastX = this.x;
        this.lastY = this.y;
        this.direction = Direction.DOWN;
        this.faction = TankFaction.ENEMY;
        this.grade = grade;
        this.holdsPowerUp = holdsPowerUp;
        this.behavior = behavior;
        
        this.currentStrategy = EnemyStrategy.BASE;
        this.strategyTimer = 180 + Math.floor(Math.random() * 120);

        // Assign a random bright color for debug path
        const colors = ['#f0f', '#0ff', '#ff0', '#0f0', '#fff', '#f90', '#f00'];
        this.debugColor = colors[Math.floor(Math.random() * colors.length)];

        this.pathfinder = new AStarPathfinder(this.gameManager.getMap());

        switch (grade) {
            case TankGrade.BASIC:
                this.hp = 1; this.speed = 1.5; this.bulletSpeed = 4; this.bulletPower = 1; break;
            case TankGrade.FAST:
                this.hp = 1; this.speed = 2.5; this.bulletSpeed = 6; this.bulletPower = 1; break;
            case TankGrade.POWER:
                this.hp = 1; this.speed = 1.5; this.bulletSpeed = 4; this.bulletPower = 2; break;
            case TankGrade.ARMOR:
                this.hp = 4; this.speed = 1.5; this.bulletSpeed = 4; this.bulletPower = 1; break;
        }

        this.shootCooldown = 60;
    }

    public upgrade(newGrade: TankGrade) {
        this.grade = newGrade;
        switch (newGrade) {
            case TankGrade.BASIC:
                this.hp = Math.max(this.hp, 1); this.speed = 1.5; this.bulletSpeed = 4; this.bulletPower = 1; break;
            case TankGrade.FAST:
                this.hp = Math.max(this.hp, 1); this.speed = 2.5; this.bulletSpeed = 6; this.bulletPower = 1; break;
            case TankGrade.POWER:
                this.hp = Math.max(this.hp, 1); this.speed = 1.5; this.bulletSpeed = 4; this.bulletPower = 2; break;
            case TankGrade.ARMOR:
                this.hp = Math.max(this.hp, 4); this.speed = 1.5; this.bulletSpeed = 4; this.bulletPower = 1; break;
        }
    }

    public applyDamage() {
        if (!this.hasSpawned) return;

        this.hp--;

        if (this.hp <= 0) {
            if (this.holdsPowerUp) {
                this.gameManager.getPowerUpSystem().spawnPowerUp(this.x, this.y);
            }
            this.isDead = true;
            let score = 0;
            switch (this.grade) {
                case TankGrade.BASIC: score = 100; break;
                case TankGrade.FAST: score = 200; break;
                case TankGrade.POWER: score = 300; break;
                case TankGrade.ARMOR: score = 400; break;
            }
            this.gameManager.getParticleSystem().emitExplosion(this.x + this.w / 2, this.y + this.h / 2, 40, '#f22');
            this.gameManager.addScore(score);
        } else {
            this.hitFlashActive = true;
            this.flashTimer = 4;
            this.gameManager.getParticleSystem().emitDebris(this.x + this.w / 2, this.y + this.h / 2, 10, '#ddd');
        }
    }

    public update(dt: number) {
        if (this.isDead) return;
        if (this.gameManager.getPowerUpSystem().clockTimer > 0) return;

        if (!this.hasSpawned) {
            this.spawnTimer--;
            if (this.spawnTimer <= 0) {
                this.hasSpawned = true;
            }
            return;
        }

        this.updateCooldowns(dt);

        if (this.hitFlashActive) {
            this.flashTimer--;
            if (this.flashTimer <= 0) {
                this.hitFlashActive = false;
            }
        }

        if (this.waitFrames > 0) {
            this.waitFrames--;
        }

        this.updateAI();
    }

    // ═══════════════════════════════════════════════════════
    //  HELPER METHODS
    // ═══════════════════════════════════════════════════════

    private isAlignedToGrid(): boolean {
        const threshold = this.speed;
        const mx = this.x % CELL_SIZE;
        const my = this.y % CELL_SIZE;
        
        // Use a more generous threshold based on speed to ensure fast tanks don't "hop" over centers
        const nearX = mx < threshold || mx > CELL_SIZE - threshold;
        const nearY = my < threshold || my > CELL_SIZE - threshold;
        
        if (nearX && nearY) {
            const { col, row } = this.getGridPos();
            // Only return true if we haven't processed THIS specific intersection yet
            if (col !== this.lastProcessedCol || row !== this.lastProcessedRow) {
                return true;
            }
        }
        return false;
    }

    private markAlignedProcessed(): void {
        const { col, row } = this.getGridPos();
        this.lastProcessedCol = col;
        this.lastProcessedRow = row;
    }

    private snapToGrid() {
        this.x = Math.round(this.x / CELL_SIZE) * CELL_SIZE;
        this.y = Math.round(this.y / CELL_SIZE) * CELL_SIZE;
    }

    private getGridPos(): { col: number; row: number } {
        return {
            col: Math.round(this.x / CELL_SIZE),
            row: Math.round(this.y / CELL_SIZE)
        };
    }

    private getOpposite(dir: Direction): Direction {
        if (dir === Direction.UP) return Direction.DOWN;
        if (dir === Direction.DOWN) return Direction.UP;
        if (dir === Direction.LEFT) return Direction.RIGHT;
        return Direction.LEFT;
    }

    /** Check if a direction is passable for a 2-cell-wide tank */
    private canMoveInDirection(dir: Direction): boolean {
        const map = this.gameManager.getMap();
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);

        const ok = (r: number, c: number) => {
            const t = map.getTerrainType(r, c);
            return t === 0 || t === 3 || t === 5; // empty, forest, ice
        };

        if (dir === Direction.UP) return ok(row - 1, col) && ok(row - 1, col + 1);
        if (dir === Direction.DOWN) return ok(row + 2, col) && ok(row + 2, col + 1);
        if (dir === Direction.LEFT) return ok(row, col - 1) && ok(row + 1, col - 1);
        return ok(row, col + 2) && ok(row + 1, col + 2); // RIGHT
    }

    /** Get all passable directions */
    private getPassableDirections(): Direction[] {
        return [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]
            .filter(d => this.canMoveInDirection(d));
    }

    /** Check if another enemy tank is overlapping or very close */
    private getOverlappingEnemy(): EnemyTank | null {
        const entities = this.gameManager.getEntities();
        for (const e of entities) {
            if (e === this || e.isDead || e.faction !== TankFaction.ENEMY) continue;
            if (!(e instanceof EnemyTank) || !(e as EnemyTank).hasSpawned) continue;
            // Check overlap with a small margin
            const dx = Math.abs(this.x - e.x);
            const dy = Math.abs(this.y - e.y);
            if (dx < this.w * 0.8 && dy < this.h * 0.8) {
                return e as EnemyTank;
            }
        }
        return null;
    }

    /** Manhattan distance to a grid cell */
    private gridDistTo(col: number, row: number): number {
        const pos = this.getGridPos();
        return Math.abs(pos.col - col) + Math.abs(pos.row - row);
    }

    private isBlockedByPlayer(): boolean {
        const player = this.gameManager.getPlayer();
        if (!player || player.isDead) return false;

        // Small margin to check just in front of the tank
        const margin = 4;
        const checkArea = {
            x: this.x,
            y: this.y,
            w: this.w,
            h: this.h
        };

        if (this.direction === Direction.UP) checkArea.y -= margin;
        else if (this.direction === Direction.DOWN) checkArea.y += margin;
        else if (this.direction === Direction.LEFT) checkArea.x -= margin;
        else if (this.direction === Direction.RIGHT) checkArea.x += margin;

        const playerBox = { x: player.x, y: player.y, w: player.w, h: player.h };
        return this.gameManager.getCollisionSystem().isIntersecting(checkArea, playerBox);
    }

    private isBlockedByBase(): boolean {
        // Small margin to check just in front of the tank
        const margin = 4;
        const checkArea = {
            x: this.x,
            y: this.y,
            w: this.w,
            h: this.h
        };

        if (this.direction === Direction.UP) checkArea.y -= margin;
        else if (this.direction === Direction.DOWN) checkArea.y += margin;
        else if (this.direction === Direction.LEFT) checkArea.x -= margin;
        else if (this.direction === Direction.RIGHT) checkArea.x += margin;

        const terrainHits = this.gameManager.getCollisionSystem().queryTerrain(checkArea);
        return terrainHits.some(hit => hit.type === 6); // 6 is Base
    }

    // ═══════════════════════════════════════════════════════
    //  LINE OF SIGHT: Can we see the player in a straight line?
    // ═══════════════════════════════════════════════════════

    private getLineOfSightDirection(): Direction | null {
        const player = this.gameManager.getPlayer();
        const map = this.gameManager.getMap();
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);

        // 1. Check for Base (Eagle) in LoS - High Priority
        for (const base of map.baseCoords) {
            // Same column
            if (col === base.c || col === base.c - 1) { // 2x2 tank footprint
                const minR = Math.min(row, base.r);
                const maxR = Math.max(row, base.r);
                let blocked = false;
                for (let r = minR + 1; r < maxR; r++) {
                    const t = map.getTerrainType(r, col);
                    if (t === 2) { blocked = true; break; } // Only steel blocks LoS to base
                }
                if (!blocked) return (base.r < row) ? Direction.UP : Direction.DOWN;
            }
            // Same row
            if (row === base.r || row === base.r - 1) {
                const minC = Math.min(col, base.c);
                const maxC = Math.max(col, base.c);
                let blocked = false;
                for (let c = minC + 1; c < maxC; c++) {
                    const t = map.getTerrainType(row, c);
                    if (t === 2) { blocked = true; break; }
                }
                if (!blocked) return (base.c < col) ? Direction.LEFT : Direction.RIGHT;
            }
        }

        // 2. Check for Player in LoS
        if (player && !player.isDead) {
            const pCol = Math.round(player.x / CELL_SIZE);
            const pRow = Math.round(player.y / CELL_SIZE);

            if (col === pCol) {
                const minR = Math.min(row, pRow);
                const maxR = Math.max(row, pRow);
                let blocked = false;
                for (let r = minR; r <= maxR; r++) {
                    const t1 = map.getTerrainType(r, col);
                    const t2 = map.getTerrainType(r, col + 1);
                    if ([1, 2, 6].includes(t1) || [1, 2, 6].includes(t2)) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) return (player.y < this.y) ? Direction.UP : Direction.DOWN;
            }

            if (row === pRow) {
                const minC = Math.min(col, pCol);
                const maxC = Math.max(col, pCol);
                let blocked = false;
                for (let c = minC; c <= maxC; c++) {
                    const t1 = map.getTerrainType(row, c);
                    const t2 = map.getTerrainType(row + 1, c);
                    if ([1, 2, 6].includes(t1) || [1, 2, 6].includes(t2)) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) return (player.x < this.x) ? Direction.LEFT : Direction.RIGHT;
            }
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════
    //  TARGET SELECTION — Priority-based
    // ═══════════════════════════════════════════════════════

    private selectTargetAndPath(forceNewStrategy: boolean = false): void {
        const pos = this.getGridPos();
        const player = this.gameManager.getPlayer();
        const powerUps = this.gameManager.getPowerUpSystem().getPowerUps().filter(p => !p.isDead);

        // ── 1. Strategy Evaluation (Commitment) ──
        if (this.strategyTimer <= 0 || forceNewStrategy || this.currentPath.length === 0) {
            // Reset timer (3-5 seconds normally)
            this.strategyTimer = 180 + Math.floor(Math.random() * 120);

            // Heuristics for picking strategy
            const baseCoords = this.gameManager.getMap().baseCoords;
            let baseDist = Infinity;
            for (const b of baseCoords) {
                const d = this.gridDistTo(b.c, b.r);
                if (d < baseDist) baseDist = d;
            }

            let closestPUDist = Infinity;
            if (powerUps.length > 0) {
                for (const pu of powerUps) {
                    const d = this.gridDistTo(Math.round(pu.x / CELL_SIZE), Math.round(pu.y / CELL_SIZE));
                    if (d < closestPUDist) closestPUDist = d;
                }
            }

            let playerDist = Infinity;
            if (player && !player.isDead) {
                playerDist = this.gridDistTo(Math.round(player.x / CELL_SIZE), Math.round(player.y / CELL_SIZE));
            }

            // Decide strategy
            if (closestPUDist < 8) {
                this.currentStrategy = EnemyStrategy.POWERUP;
            } else if (playerDist < 10) {
                this.currentStrategy = EnemyStrategy.PLAYER;
            } else {
                this.currentStrategy = EnemyStrategy.BASE;
            }
        }

        // ── 2. Strategy Execution ──
        let path: Direction[] = [];
        if (this.currentStrategy === EnemyStrategy.POWERUP && powerUps.length > 0) {
            let closestPU = powerUps[0];
            let minDist = Infinity;
            for (const pu of powerUps) {
                const d = this.gridDistTo(Math.round(pu.x / CELL_SIZE), Math.round(pu.y / CELL_SIZE));
                if (d < minDist) { minDist = d; closestPU = pu; }
            }
            path = this.pathfinder.findPath(pos.col, pos.row, Math.round(closestPU.x / CELL_SIZE), Math.round(closestPU.y / CELL_SIZE), this.bulletPower);
        }

        if (path.length === 0 && this.currentStrategy === EnemyStrategy.PLAYER && player && !player.isDead) {
            path = this.pathfinder.findPathToPlayer(pos.col, pos.row, Math.round(player.x / CELL_SIZE), Math.round(player.y / CELL_SIZE), this.bulletPower);
        }

        if (path.length === 0) {
            // Default or fallback to BASE
            this.currentStrategy = EnemyStrategy.BASE;
            path = this.pathfinder.findPathToBase(pos.col, pos.row, this.bulletPower);

            // FALLBACK: If base is unreachable, turn to attack player
            if (path.length === 0 && player && !player.isDead) {
                this.currentStrategy = EnemyStrategy.PLAYER;
                path = this.pathfinder.findPathToPlayer(pos.col, pos.row, Math.round(player.x / CELL_SIZE), Math.round(player.y / CELL_SIZE), this.bulletPower);
            }
        }

        // ── 3. Finalize ──
        this.currentPath = path;
        this.updateDebugPathPoints();
    }

    private updateDebugPathPoints(): void {
        this.debugPathPoints = [];
        if (this.currentPath.length === 0) return;

        let { col, row } = this.getGridPos();
        this.debugPathPoints.push({ x: col * CELL_SIZE, y: row * CELL_SIZE });

        for (const dir of this.currentPath) {
            if (dir === Direction.UP) row--;
            else if (dir === Direction.DOWN) row++;
            else if (dir === Direction.LEFT) col--;
            else if (dir === Direction.RIGHT) col++;
            this.debugPathPoints.push({ x: col * CELL_SIZE, y: row * CELL_SIZE });
        }
    }

    // ═══════════════════════════════════════════════════════
    //  MAIN AI LOOP
    // ═══════════════════════════════════════════════════════

    private updateAI() {
        // Track if stuck
        const distSq = (this.x - this.lastX) ** 2 + (this.y - this.lastY) ** 2;
        if (distSq < 0.01) {
            this.positionQuietFrames++;
        } else {
            this.positionQuietFrames = 0;
        }
        this.lastX = this.x;
        this.lastY = this.y;

        // Emergency recovery: much faster trigger
        if (this.stuckFrames > 25 || this.positionQuietFrames > 35) {
            this.recoverFromStuck();
            return;
        }

        const aligned = this.isAlignedToGrid();
        if (aligned) {
            this.snapToGrid();
            this.markAlignedProcessed(); // Mark so we don't trigger again until we enter a new cell
        }

        // ── Strategy Maintenance ──
        this.strategyTimer--;

        // ── Priority 1: Line-of-sight to player or base → SHOOT ──
        if (aligned) {
            const losDir = this.getLineOfSightDirection();
            if (losDir !== null) {
                if (this.direction === losDir) {
                    this.shoot();
                } else {
                    // Turn to face target in LoS — but DON'T clear currentPath
                    // We just "pause" the path while we shoot
                    this.direction = losDir;
                    this.stuckFrames = 0;
                    this.updateDebugPathPoints(); // Keep visualization anchored
                }
            }
        }

        // ── Refresh pathfinding periodically ──
        if (aligned) {
            this.pathRefreshTimer--;
            if (this.pathRefreshTimer <= 0) {
                // Keep same strategy but re-calculate path to it
                this.selectTargetAndPath(false);
                this.pathRefreshTimer = 45 + Math.floor(Math.random() * 30);
            }
        }

        // ── Crowding avoidance: Asymmetric Priority ──
        if (aligned && this.waitFrames <= 0) {
            const crowdingEnemy = this.getOverlappingEnemy();
            if (crowdingEnemy) {
                const myStuck = this.stuckFrames;
                const otherStuck = (crowdingEnemy as any).stuckFrames;
                
                const myPriority = myStuck > otherStuck || (myStuck === otherStuck && this.id < crowdingEnemy.id);
                
                if (myPriority) {
                    const passable = this.getPassableDirections();
                    const perpDirs = passable.filter(d =>
                        d !== this.direction && d !== this.getOpposite(this.direction)
                    );
                    const choices = perpDirs.length > 0 ? perpDirs : passable;
                    if (choices.length > 0) {
                        this.direction = choices[Math.floor(Math.random() * choices.length)];
                        this.currentPath = [];
                        this.pathRefreshTimer = 10;
                        this.stuckFrames = 0;
                    }
                } else {
                    this.waitFrames = 12; 
                }
            }
        }

        // ── Follow path ──
        if (this.currentPath.length > 0 && aligned) {
            const nextDir = this.currentPath[0];

            if (this.canMoveInDirection(nextDir)) {
                if (this.direction !== nextDir) {
                    this.direction = nextDir;
                }
                this.currentPath.shift();
                if (this.debugPathPoints.length > 0) this.debugPathPoints.shift();
                this.stuckFrames = 0;
            } else {
                // Path is blocked — is it destructible?
                const pos = this.getGridPos();
                if (this.pathfinder.isDestructibleAhead(pos.col, pos.row, nextDir, this.bulletPower)) {
                    if (this.direction !== nextDir) {
                        this.direction = nextDir;
                    }
                    this.shoot();
                    this.stuckFrames++;
                } else {
                    this.currentPath = [];
                    this.debugPathPoints = [];
                    this.pathRefreshTimer = 0;
                }
            }
        }

        // ── Execute movement ──
        this.executeMovement();

        // ── Shoot at base/walls/player - ONLY if aligned to grid ──
        if (aligned && Math.floor(Date.now() / 16) % 2 === 0) {
            this.handleOpportunisticShooting();
        }
    }

    // ═══════════════════════════════════════════════════════
    //  MOVEMENT
    // ═══════════════════════════════════════════════════════

    private executeMovement() {
        let dx = 0, dy = 0;
        let moveSpeed = this.speed;
        if (this.gameManager.getPowerUpSystem().enemySpeedBoostTimer > 0) {
            moveSpeed *= 2;
        }
        if (this.direction === Direction.UP) dy = -moveSpeed;
        else if (this.direction === Direction.DOWN) dy = moveSpeed;
        else if (this.direction === Direction.LEFT) dx = -moveSpeed;
        else if (this.direction === Direction.RIGHT) dx = moveSpeed;

        const res = this.gameManager.getCollisionSystem().resolveMovement(this, dx, dy);

        // If we intended to move but were blocked
        if ((dx !== 0 && res.dx === 0) || (dy !== 0 && res.dy === 0)) {
            // Priority: Shoot if blocked by base or player
            if (this.isBlockedByBase() || this.isBlockedByPlayer()) {
                this.shoot();
                this.stuckFrames = 0;
            } else {
                this.stuckFrames++;
            }
        } else {
            // Movement successful
            if (this.stuckFrames > 0) this.stuckFrames = 0;
        }

        this.x += res.dx;
        this.y += res.dy;
    }

    // ═══════════════════════════════════════════════════════
    //  SHOOTING
    // ═══════════════════════════════════════════════════════

    /** Shoot at targets of opportunity: walls ahead, base ahead, player ahead */
    private handleOpportunisticShooting() {
        const map = this.gameManager.getMap();
        const col = Math.floor((this.x + this.w / 2) / CELL_SIZE);
        const row = Math.floor((this.y + this.h / 2) / CELL_SIZE);

        for (let step = 1; step <= 30; step++) {
            let checkR = row, checkC = col;
            if (this.direction === Direction.UP) checkR = row - step;
            else if (this.direction === Direction.DOWN) checkR = row + step;
            else if (this.direction === Direction.LEFT) checkC = col - step;
            else if (this.direction === Direction.RIGHT) checkC = col + step;

            if (checkR < 0 || checkR >= GRID_ROWS || checkC < 0 || checkC >= GRID_COLS) break;

            const type = map.getTerrainType(checkR, checkC);

            // Base ahead — FIRE
            if (type === 6) {
                this.shoot();
                return;
            }

            // Player ahead
            const player = this.gameManager.getPlayer();
            if (player && !player.isDead) {
                const px1 = Math.floor(player.x / CELL_SIZE);
                const py1 = Math.floor(player.y / CELL_SIZE);
                const px2 = Math.floor((player.x + player.w - 1) / CELL_SIZE);
                const py2 = Math.floor((player.y + player.h - 1) / CELL_SIZE);

                if ((checkR >= py1 && checkR <= py2) && (checkC >= px1 && checkC <= px2)) {
                    this.shoot();
                    return;
                }
            }

            // Brick walls
            if (type === 1) {
                this.shoot();
                return;
            }

            // Impassable steel
            if (type === 2) {
                if (this.bulletPower >= 2) this.shoot();
                return;
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    //  RECOVERY
    // ═══════════════════════════════════════════════════════

    private recoverFromStuck() {
        this.snapToGrid();

        // 1. Back off slightly to unjam
        const backDir = this.getOpposite(this.direction);
        let bx = 0, by = 0;
        if (backDir === Direction.UP) by = -2;
        else if (backDir === Direction.DOWN) by = 2;
        else if (backDir === Direction.LEFT) bx = -2;
        else if (backDir === Direction.RIGHT) bx = 2;
        this.x += bx;
        this.y += by;

        // 2. Immediate look for target
        const losDir = this.getLineOfSightDirection();
        if (losDir !== null) {
            this.direction = losDir;
            this.shoot();
            this.stuckFrames = 0;
            return;
        }

        // 3. Try to shoot through whatever blocked us
        this.shoot();

        // 4. Force a new direction and path
        const passable = this.getPassableDirections();
        const choices = passable.filter(d => d !== this.direction);

        if (choices.length > 0) {
            this.direction = choices[Math.floor(Math.random() * choices.length)];
        } else if (passable.length > 0) {
            this.direction = passable[Math.floor(Math.random() * passable.length)];
        } else {
            this.direction = this.getOpposite(this.direction);
        }

        this.stuckFrames = 0;
        this.positionQuietFrames = 0;
        this.currentPath = [];
        this.pathRefreshTimer = 0; // Force path update next frame
        this.strategyTimer = 0;    // Force strategy re-evaluation
    }

    // ═══════════════════════════════════════════════════════
    //  RENDERING
    // ═══════════════════════════════════════════════════════

    public render(ctx: CanvasRenderingContext2D) {
        if (!this.hasSpawned) {
            ctx.fillStyle = (this.spawnTimer % 8 < 4) ? '#fff' : '#888';
            ctx.fillRect(this.x, this.y, this.w, this.h);
            return;
        }

        let color = '#fff';
        if (this.grade === TankGrade.FAST) color = '#bbb';
        else if (this.grade === TankGrade.POWER) color = '#666';
        else if (this.grade === TankGrade.ARMOR) {
            if (this.hitFlashActive) color = '#fff';
            else if (this.hp === 4) color = '#0066ff';
            else if (this.hp === 3) color = '#5577bb';
            else if (this.hp === 2) color = '#888899';
            else color = '#aaaaaa';
        }

        this.colorOverride = color;
        super.render(ctx);

        // ── AI PATH DEBUGGING (Ctrl+D to toggle) ──
        if (this.gameManager.debugMode && this.debugPathPoints.length > 1) {
            ctx.save();
            ctx.strokeStyle = this.debugColor;
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            
            // Start from tank center
            ctx.moveTo(this.x + BATTLE_AREA_X + this.w / 2, this.y + BATTLE_AREA_Y + this.h / 2);
            
            for (let i = 1; i < this.debugPathPoints.length; i++) {
                const p = this.debugPathPoints[i];
                ctx.lineTo(p.x + BATTLE_AREA_X + this.w / 2, p.y + BATTLE_AREA_Y + this.h / 2);
            }
            ctx.stroke();

            // Target marker
            const target = this.debugPathPoints[this.debugPathPoints.length - 1];
            ctx.beginPath();
            ctx.arc(target.x + BATTLE_AREA_X + this.w / 2, target.y + BATTLE_AREA_Y + this.h / 2, 4, 0, Math.PI * 2);
            ctx.fillStyle = this.debugColor;
            ctx.fill();

            ctx.restore();
        }

        // Draw blinking red light on turret for power-up carriers
        if (this.holdsPowerUp && Math.floor(Date.now() / 250) % 2 === 0) {
            // Adjust to the battle area coordinate system used in super.render
            const drawX = this.x + BATTLE_AREA_X + this.w / 2;
            const drawY = this.y + BATTLE_AREA_Y + this.h / 2;

            ctx.save();
            ctx.beginPath();
            // Center the light exactly in the middle of the turret
            ctx.arc(drawX, drawY, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#f22';
            ctx.shadowColor = '#f00';
            ctx.shadowBlur = 8;
            ctx.fill();

            // Small white highlight core
            ctx.beginPath();
            ctx.arc(drawX, drawY, 1, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.restore();
        }
    }
}
