import { Tank } from './Tank';
import { TankGrade, TankFaction, Direction, EnemyBehavior } from '../types';
import { GameManager } from '../engine/GameManager';
import { CELL_SIZE } from '../constants';
import { AStarPathfinder } from '../systems/AStarPathfinder';

export class EnemyTank extends Tank {
    private spawnTimer: number = 60;
    public hasSpawned: boolean = false;

    // AI State
    private stuckFrames: number = 0;
    private lastX: number = 0;
    private lastY: number = 0;
    private positionQuietFrames: number = 0;

    public holdsPowerUp: boolean = false;
    private flashTimer: number = 0;
    private hitFlashActive: boolean = false;

    // Advanced AI
    public behavior: EnemyBehavior = EnemyBehavior.ATTACK;
    private pathfinder: AStarPathfinder;
    private currentPath: Direction[] = [];
    private pathRefreshTimer: number = 0;

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

        this.updateAI();
    }

    // ═══════════════════════════════════════════════════════
    //  HELPER METHODS
    // ═══════════════════════════════════════════════════════

    private isAlignedToGrid(): boolean {
        const mx = Math.abs(this.x % CELL_SIZE);
        const my = Math.abs(this.y % CELL_SIZE);
        return (mx < 0.2 || mx > CELL_SIZE - 0.2) && (my < 0.2 || my > CELL_SIZE - 0.2);
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

    // ═══════════════════════════════════════════════════════
    //  LINE OF SIGHT: Can we see the player in a straight line?
    // ═══════════════════════════════════════════════════════

    private getLineOfSightDirection(): Direction | null {
        const player = this.gameManager.getPlayer();
        if (!player || player.isDead) return null;

        const map = this.gameManager.getMap();
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);
        const pCol = Math.round(player.x / CELL_SIZE);
        const pRow = Math.round(player.y / CELL_SIZE);

        // Same column — check vertical line of sight
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
            if (!blocked) {
                return (player.y < this.y) ? Direction.UP : Direction.DOWN;
            }
        }

        // Same row — check horizontal line of sight
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
            if (!blocked) {
                return (player.x < this.x) ? Direction.LEFT : Direction.RIGHT;
            }
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════
    //  TARGET SELECTION — Priority-based
    // ═══════════════════════════════════════════════════════

    private selectTargetAndPath(): void {
        const pos = this.getGridPos();
        const player = this.gameManager.getPlayer();
        const powerUps = this.gameManager.getPowerUpSystem().getPowerUps().filter(p => !p.isDead);

        // Priority 2: Power-ups on the map → go grab them
        if (powerUps.length > 0) {
            // Find the closest power-up by grid distance
            let closestPU = powerUps[0];
            let closestDist = Infinity;
            for (const pu of powerUps) {
                const puCol = Math.round(pu.x / CELL_SIZE);
                const puRow = Math.round(pu.y / CELL_SIZE);
                const d = this.gridDistTo(puCol, puRow);
                if (d < closestDist) {
                    closestDist = d;
                    closestPU = pu;
                }
            }

            const puCol = Math.round(closestPU.x / CELL_SIZE);
            const puRow = Math.round(closestPU.y / CELL_SIZE);
            const path = this.pathfinder.findPath(pos.col, pos.row, puCol, puRow, this.bulletPower);
            if (path.length > 0) {
                this.currentPath = path;
                return;
            }
        }

        // Priority 3: Player nearby (within ~200px = 10 cells) → hunt them
        if (player && !player.isDead) {
            const pCol = Math.round(player.x / CELL_SIZE);
            const pRow = Math.round(player.y / CELL_SIZE);
            const playerDist = this.gridDistTo(pCol, pRow);

            if (playerDist < 12) {
                const path = this.pathfinder.findPathToPlayer(pos.col, pos.row, pCol, pRow, this.bulletPower);
                if (path.length > 0) {
                    this.currentPath = path;
                    return;
                }
            }
        }

        // Priority 4: Default — attack the base via shortest route
        const basePath = this.pathfinder.findPathToBase(pos.col, pos.row, this.bulletPower);
        if (basePath.length > 0) {
            this.currentPath = basePath;
            return;
        }

        // Fallback: if no path found, head toward player
        if (player && !player.isDead) {
            const pCol = Math.round(player.x / CELL_SIZE);
            const pRow = Math.round(player.y / CELL_SIZE);
            const path = this.pathfinder.findPathToPlayer(pos.col, pos.row, pCol, pRow, this.bulletPower);
            if (path.length > 0) {
                this.currentPath = path;
            }
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

        // Emergency recovery
        if (this.stuckFrames > 30 || this.positionQuietFrames > 45) {
            this.recoverFromStuck();
            return;
        }

        const aligned = this.isAlignedToGrid();
        if (aligned) this.snapToGrid();

        // ── Priority 1: Line-of-sight to player → SHOOT ──
        const losDir = this.getLineOfSightDirection();
        if (losDir !== null) {
            if (this.direction === losDir) {
                // Already facing — fire!
                this.shoot();
            } else if (aligned) {
                // Turn to face the player
                this.direction = losDir;
                this.stuckFrames = 0;
            }
            // Still proceed to move (can shoot AND move)
        }

        // ── Refresh pathfinding periodically ──
        if (aligned) {
            this.pathRefreshTimer--;
            if (this.pathRefreshTimer <= 0 || this.currentPath.length === 0) {
                this.pathRefreshTimer = 45 + Math.floor(Math.random() * 15);
                this.selectTargetAndPath();
            }
        }

        // ── Crowding avoidance: detour if overlapping another enemy ──
        if (aligned) {
            const crowdingEnemy = this.getOverlappingEnemy();
            if (crowdingEnemy) {
                // The tank that has been stuck longer should reroute
                if (this.stuckFrames >= (crowdingEnemy as any).stuckFrames) {
                    const passable = this.getPassableDirections();
                    // Prefer perpendicular directions
                    const perpDirs = passable.filter(d =>
                        d !== this.direction && d !== this.getOpposite(this.direction)
                    );
                    const choices = perpDirs.length > 0 ? perpDirs : passable;
                    if (choices.length > 0) {
                        this.direction = choices[Math.floor(Math.random() * choices.length)];
                        this.currentPath = [];
                        this.pathRefreshTimer = 15;
                        this.stuckFrames = 0;
                    }
                }
            }
        }

        // ── Follow path ──
        if (this.currentPath.length > 0 && aligned) {
            const nextDir = this.currentPath[0];

            if (this.canMoveInDirection(nextDir)) {
                // Path is clear — go
                if (this.direction !== nextDir) {
                    this.direction = nextDir;
                }
                this.currentPath.shift();
                this.stuckFrames = 0;
            } else {
                // Path is blocked — is it destructible?
                const pos = this.getGridPos();
                if (this.pathfinder.isDestructibleAhead(pos.col, pos.row, nextDir, this.bulletPower)) {
                    // Face the obstacle and shoot to clear
                    if (this.direction !== nextDir) {
                        this.direction = nextDir;
                    }
                    this.shoot();
                    this.stuckFrames++;
                } else {
                    // Truly impassable — recalculate path
                    this.currentPath = [];
                    this.pathRefreshTimer = 0; // Force immediate refresh
                }
            }
        }

        // ── Execute movement ──
        this.executeMovement();

        // ── Shoot at base/walls that are ahead ──
        if (aligned) {
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

        if ((dx !== 0 && res.dx === 0) || (dy !== 0 && res.dy === 0)) {
            this.stuckFrames++;
        } else {
            this.stuckFrames = 0;
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

        // Scan ahead up to 8 cells
        for (let step = 1; step <= 8; step++) {
            let checkR = row, checkC = col;
            if (this.direction === Direction.UP) checkR = row - step;
            else if (this.direction === Direction.DOWN) checkR = row + step;
            else if (this.direction === Direction.LEFT) checkC = col - step;
            else if (this.direction === Direction.RIGHT) checkC = col + step;

            const type = map.getTerrainType(checkR, checkC);

            // Base ahead — FIRE IMMEDIATELY
            if (type === 6) {
                this.shoot();
                return;
            }

            // Player ahead
            const player = this.gameManager.getPlayer();
            if (player && !player.isDead) {
                const pCol = Math.floor((player.x + player.w / 2) / CELL_SIZE);
                const pRow = Math.floor((player.y + player.h / 2) / CELL_SIZE);
                if (checkR === pRow && checkC === pCol) {
                    this.shoot();
                    return;
                }
            }

            // Wall ahead — shoot if it's on our path and destructible
            if (type === 1 || (type === 2 && this.bulletPower >= 2)) {
                // Only shoot with some probability if it's far away
                if (step <= 3 || Math.random() < 0.1) {
                    this.shoot();
                }
                return;
            }

            // Steel that we can't break — stop scanning
            if (type === 2) return;
        }
    }

    // ═══════════════════════════════════════════════════════
    //  RECOVERY
    // ═══════════════════════════════════════════════════════

    private recoverFromStuck() {
        this.snapToGrid();
        this.shoot(); // Try to blast through

        const passable = this.getPassableDirections();
        const choices = passable.filter(d => d !== this.direction && d !== this.getOpposite(this.direction));

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
        this.pathRefreshTimer = 0;
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

        if (this.holdsPowerUp && Math.floor(Date.now() / 150) % 2 === 0) {
            color = '#f0f';
        }

        this.colorOverride = color;
        super.render(ctx);
    }
}
