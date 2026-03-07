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
    private randomTurnTimer: number = 180;
    private lastX: number = 0;
    private lastY: number = 0;
    private positionQuietFrames: number = 0;

    public holdsPowerUp: boolean = false;
    private flashTimer: number = 0;
    private hitFlashActive: boolean = false;

    // Advanced AI
    public behavior: EnemyBehavior = EnemyBehavior.ATTACK;
    private pathfinder: AStarPathfinder | null = null;
    private currentPath: Direction[] = [];
    private pathRefreshTimer: number = 0;
    private patrolPoints: { col: number; row: number }[] = [];
    private currentPatrolIndex: number = 0;
    private defenseHome: { col: number; row: number } | null = null;

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

        if (behavior === EnemyBehavior.DEFENSE) {
            this.defenseHome = { col: Math.round(x), row: Math.round(y) };
            this.initPatrolPoints();
        }

        switch (grade) {
            case TankGrade.BASIC:
                this.hp = 1;
                this.speed = 1.5;
                this.bulletSpeed = 4;
                this.bulletPower = 1;
                break;
            case TankGrade.FAST:
                this.hp = 1;
                this.speed = 2.5;
                this.bulletSpeed = 6;
                this.bulletPower = 1;
                break;
            case TankGrade.POWER:
                this.hp = 1;
                this.speed = 1.5;
                this.bulletSpeed = 4;
                this.bulletPower = 2;
                break;
            case TankGrade.ARMOR:
                this.hp = 4;
                this.speed = 1.5;
                this.bulletSpeed = 4;
                this.bulletPower = 1;
                break;
        }

        this.shootCooldown = 60;
    }

    private initPatrolPoints() {
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);
        this.patrolPoints = [
            { col, row },
            { col: Math.min(col + 4, 28), row },
            { col: Math.min(col + 4, 28), row: Math.min(row + 4, 36) },
            { col, row: Math.min(row + 4, 36) }
        ];
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
            // Drop power-up if this was a flashing enemy
            if (this.holdsPowerUp) {
                this.gameManager.getPowerUpSystem().spawnPowerUp(this.x, this.y);
            }
            this.isDead = true;
            // Reward score based on grade
            let score = 0;
            switch (this.grade) {
                case TankGrade.BASIC: score = 100; break;
                case TankGrade.FAST: score = 200; break;
                case TankGrade.POWER: score = 300; break;
                case TankGrade.ARMOR: score = 400; break;
            }
            // Trigger explosion 
            this.gameManager.getParticleSystem().emitExplosion(this.x + this.w / 2, this.y + this.h / 2, 40, '#f22');
            this.gameManager.addScore(score);
        } else {
            // Armor tank hit flash
            this.hitFlashActive = true;
            this.flashTimer = 4;
            // Emit minor debris
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

    private isAlignedToGrid(): boolean {
        // Tank is aligned if both x and y are multiples of CELL_SIZE (20)
        const mx = Math.abs(this.x % CELL_SIZE);
        const my = Math.abs(this.y % CELL_SIZE);
        // Use a stricter threshold (0.2px) to prevent premature turning
        const alignedX = mx < 0.2 || mx > CELL_SIZE - 0.2;
        const alignedY = my < 0.2 || my > CELL_SIZE - 0.2;
        return alignedX && alignedY;
    }

    private snapToGrid() {
        this.x = Math.round(this.x / CELL_SIZE) * CELL_SIZE;
        this.y = Math.round(this.y / CELL_SIZE) * CELL_SIZE;
    }

    private getLineOfSightDirection(): Direction | null {
        const player = this.gameManager.getPlayer();
        if (!player || player.isDead) return null;

        const map = this.gameManager.getMap();

        // Strictly use snapped grid coordinates for the 2-cell check
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);
        const pCol = Math.round(player.x / CELL_SIZE);
        const pRow = Math.round(player.y / CELL_SIZE);

        if (col === pCol) {
            // Check BOTH columns of the 2-cell width path
            const minY = Math.min(this.y, player.y);
            const maxY = Math.max(this.y, player.y);
            const minR = Math.floor(minY / CELL_SIZE);
            const maxR = Math.floor(maxY / CELL_SIZE);

            let blocked = false;
            for (let r = minR; r <= maxR; r++) {
                const t1 = map.getTerrainType(r, col);
                const t2 = map.getTerrainType(r, col + 1);
                // Obstacles: brick(1), steel(2), or base(6)
                if ([1, 2, 6].includes(t1) || [1, 2, 6].includes(t2)) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) {
                return (player.y < this.y) ? Direction.UP : Direction.DOWN;
            }
        } else if (row === pRow) {
            // Check BOTH rows of the 2-cell height path
            const minX = Math.min(this.x, player.x);
            const maxX = Math.max(this.x, player.x);
            const minC = Math.floor(minX / CELL_SIZE);
            const maxC = Math.floor(maxX / CELL_SIZE);

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

    /** Returns the best axis-aligned direction to move toward a target pixel position, filtered by passable dirs */
    private getDirectionToward(targetX: number, targetY: number): Direction {
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2;
        const dx = targetX - cx;
        const dy = targetY - cy;

        // Prefer the axis with the larger delta
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? Direction.RIGHT : Direction.LEFT;
        } else {
            return dy > 0 ? Direction.DOWN : Direction.UP;
        }
    }

    /** Check if a direction is passable for a 2-cell-wide tank */
    private canMoveInDirection(dir: Direction): boolean {
        const map = this.gameManager.getMap();
        // Since we snapToGrid before calling this at junctions, x and y should be multiples of CELL_SIZE
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);

        // Helper: check if a specific cell is passable
        const ok = (r: number, c: number) => {
            const t = map.getTerrainType(r, c);
            return t === 0 || t === 3 || t === 5; // empty, forest, ice
        };

        if (dir === Direction.UP) {
            return ok(row - 1, col) && ok(row - 1, col + 1);
        } else if (dir === Direction.DOWN) {
            return ok(row + 2, col) && ok(row + 2, col + 1);
        } else if (dir === Direction.LEFT) {
            return ok(row, col - 1) && ok(row + 1, col - 1);
        } else { // RIGHT
            return ok(row, col + 2) && ok(row + 1, col + 2);
        }
    }

    /** Check if the obstacle ahead is destructible (brick) */
    private isBrickAhead(): boolean {
        const map = this.gameManager.getMap();
        const col = Math.round(this.x / CELL_SIZE);
        const row = Math.round(this.y / CELL_SIZE);
        const isBrick = (r: number, c: number) => map.getTerrainType(r, c) === 1;

        if (this.direction === Direction.UP) {
            return isBrick(row - 1, col) || isBrick(row - 1, col + 1);
        } else if (this.direction === Direction.DOWN) {
            return isBrick(row + 2, col) || isBrick(row + 2, col + 1);
        } else if (this.direction === Direction.LEFT) {
            return isBrick(row, col - 1) || isBrick(row + 1, col - 1);
        } else {
            return isBrick(row, col + 2) || isBrick(row + 1, col + 2);
        }
    }

    /** Get all passable directions */
    private getPassableDirections(): Direction[] {
        return [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]
            .filter(d => this.canMoveInDirection(d));
    }

    /** Get the opposite direction */
    private getOpposite(dir: Direction): Direction {
        if (dir === Direction.UP) return Direction.DOWN;
        if (dir === Direction.DOWN) return Direction.UP;
        if (dir === Direction.LEFT) return Direction.RIGHT;
        return Direction.LEFT;
    }

    /** Pick the best direction from a list, biased toward a target */
    private pickBestDirection(candidates: Direction[], targetDir: Direction): Direction {
        // If target direction is in candidates, pick it with 60% chance
        if (candidates.includes(targetDir) && Math.random() < 0.6) {
            return targetDir;
        }
        // Otherwise pick a random candidate
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /** Find the closest power-up on the map and return direction toward it, or null */
    private getPowerUpDirection(): Direction | null {
        const powerUps = this.gameManager.getPowerUpSystem().getPowerUps().filter(p => !p.isDead);
        if (powerUps.length === 0) return null;

        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2;

        let closest = powerUps[0];
        let closestDist = Infinity;
        for (const pu of powerUps) {
            const d = Math.abs(pu.x - cx) + Math.abs(pu.y - cy);
            if (d < closestDist) {
                closestDist = d;
                closest = pu;
            }
        }

        return this.getDirectionToward(closest.x + closest.w / 2, closest.y + closest.h / 2);
    }

    /** Get direction toward the base center */
    private getBaseDirection(): Direction {
        const baseCoords = this.gameManager.getMap().baseCoords;
        if (baseCoords.length === 0) {
            return Direction.DOWN;
        }
        const avgC = baseCoords.reduce((s, b) => s + b.c, 0) / baseCoords.length;
        const avgR = baseCoords.reduce((s, b) => s + b.r, 0) / baseCoords.length;
        const baseX = (avgC + 0.5) * CELL_SIZE;
        const baseY = (avgR + 0.5) * CELL_SIZE;
        return this.getDirectionToward(baseX, baseY);
    }

    /** Check if the player is within a given pixel distance */
    private isPlayerNearby(range: number): boolean {
        const player = this.gameManager.getPlayer();
        if (!player || player.isDead) return false;
        const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
        const dy = (player.y + player.h / 2) - (this.y + this.h / 2);
        return Math.abs(dx) + Math.abs(dy) < range;
    }

    private shouldUseAStar(): boolean {
        return true;
    }

    private updatePath() {
        if (!this.pathfinder) return;

        this.pathRefreshTimer--;
        if (this.pathRefreshTimer > 0 && this.currentPath.length > 0) return;

        this.pathRefreshTimer = 30; // Always reset timer to prevent spamming

        const startCol = Math.round(this.x / CELL_SIZE);
        const startRow = Math.round(this.y / CELL_SIZE);

        // Try base first (highest priority)
        const basePath = this.pathfinder.findPathToBase(startCol, startRow);
        if (basePath.length > 0) {
            this.currentPath = basePath;
            return;
        }

        let targetCol: number = 14, targetRow: number = 36;

        switch (this.behavior) {
            case EnemyBehavior.ATTACK:
                const player = this.gameManager.getPlayer();
                if (player && !player.isDead && this.isPlayerNearby(300)) {
                    targetCol = Math.round(player.x / CELL_SIZE);
                    targetRow = Math.round(player.y / CELL_SIZE);
                } else {
                    const baseCoords = this.gameManager.getMap().baseCoords;
                    if (baseCoords.length > 0) {
                        const target = baseCoords[0];
                        targetCol = target.c;
                        targetRow = target.r;
                    }
                }
                break;

            case EnemyBehavior.GUERRILLA:
                const powerUps = this.gameManager.getPowerUpSystem().getPowerUps().filter(p => !p.isDead);
                if (powerUps.length > 0) {
                    const closest = powerUps[0];
                    targetCol = Math.round(closest.x / CELL_SIZE);
                    targetRow = Math.round(closest.y / CELL_SIZE);
                } else {
                    targetCol = Math.round(Math.random() * 28);
                    targetRow = Math.round(Math.random() * 36);
                }
                break;

            case EnemyBehavior.DEFENSE:
                if (this.patrolPoints.length > 0) {
                    const target = this.patrolPoints[this.currentPatrolIndex];
                    const dist = Math.abs(this.x / CELL_SIZE - target.col) + Math.abs(this.y / CELL_SIZE - target.row);
                    if (dist < 2) {
                        this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
                    }
                    targetCol = target.col;
                    targetRow = target.row;
                } else {
                    targetCol = this.defenseHome?.col ?? startCol;
                    targetRow = this.defenseHome?.row ?? startRow;
                }
                break;
        }

        const newPath = this.pathfinder.findPath(startCol, startRow, targetCol, targetRow);
        if (newPath.length > 0) {
            this.currentPath = newPath;
        }
    }

    private followPath(): boolean {
        if (this.currentPath.length === 0) return false;

        const nextDir = this.currentPath[0];
        if (this.direction === nextDir) {
            if (this.canMoveInDirection(nextDir)) {
                this.currentPath.shift();
                return true;
            } else {
                // If blocked by brick, shoot
                if (this.isBrickAhead()) {
                    this.shoot();
                } else {
                    // Impassable, clear path and let AI try something else
                    this.currentPath = [];
                }
                return false;
            }
        } else if (this.isAlignedToGrid()) {
            this.snapToGrid();
            // Don't turn if blocked, just try to shoot or clear path
            if (this.canMoveInDirection(nextDir)) {
                this.direction = nextDir;
                this.currentPath.shift();
                this.stuckFrames = 0;
            } else {
                if (this.isBrickAhead()) this.shoot();
                else this.currentPath = [];
            }
        }
        return false;
    }

    private updateAI() {
        const distSq = (this.x - this.lastX) ** 2 + (this.y - this.lastY) ** 2;
        if (distSq < 0.01) {
            this.positionQuietFrames++;
        } else {
            this.positionQuietFrames = 0;
        }
        this.lastX = this.x;
        this.lastY = this.y;

        if (this.stuckFrames > 30 || this.positionQuietFrames > 30) {
            this.recoverFromStuck();
            return;
        }

        const aligned = this.isAlignedToGrid();
        if (aligned) {
            this.snapToGrid();
        }

        const losDir = this.getLineOfSightDirection();

        if (losDir !== null) {
            if (this.direction === losDir) {
                if (aligned) this.shoot();
            } else if (aligned && this.canMoveInDirection(losDir)) {
                this.snapToGrid();
                this.direction = losDir;
                this.stuckFrames = 0;
            }
        }

        if (this.shouldUseAStar() && aligned) {
            this.updatePath();

            const passable = this.getPassableDirections();
            const sideDirs = passable.filter(d => d !== this.direction && d !== this.getOpposite(this.direction));

            if (sideDirs.length > 0 && Math.random() < 0.3) {
                const baseDir = this.getBaseDirection();
                this.direction = this.pickBestDirection(sideDirs, baseDir);
                this.currentPath = [];
                this.stuckFrames = 0;
            } else if (this.followPath()) {
                this.stuckFrames = 0;
            }
        } else {
            this.executeLegacyAI(aligned);
        }

        this.executeMovement();

        if (aligned) {
            this.handleShooting();
        }
    }

    private executeLegacyAI(aligned: boolean) {
        if (this.isPlayerNearby(200) && aligned) {
            const player = this.gameManager.getPlayer();
            const chaseDir = this.getDirectionToward(player.x + player.w / 2, player.y + player.h / 2);
            if (this.canMoveInDirection(chaseDir) && this.direction !== chaseDir) {
                this.snapToGrid();
                this.direction = chaseDir;
                this.stuckFrames = 0;
            }
        } else if (aligned && this.getPowerUpDirection() !== null) {
            const puDir = this.getPowerUpDirection()!;
            if (this.canMoveInDirection(puDir) && this.direction !== puDir) {
                this.snapToGrid();
                this.direction = puDir;
                this.stuckFrames = 0;
            }
        } else if (aligned) {
            const canMoveFwd = this.canMoveInDirection(this.direction);
            const brickAhead = !canMoveFwd && this.isBrickAhead();

            if (canMoveFwd) {
                this.randomTurnTimer--;
                if (this.randomTurnTimer <= 0) {
                    this.randomTurnTimer = 60 + Math.floor(Math.random() * 60);
                    const passable = this.getPassableDirections();
                    const sideDirs = passable.filter(d => d !== this.direction && d !== this.getOpposite(this.direction));
                    if (sideDirs.length > 0) {
                        const turnChance = 0.8;
                        if (Math.random() < turnChance) {
                            const baseDir = this.getBaseDirection();
                            this.snapToGrid();
                            this.direction = this.pickBestDirection(sideDirs, baseDir);
                            this.stuckFrames = 0;
                        }
                    }
                }
            } else if (brickAhead) {
                this.shoot();
                if (this.stuckFrames >= 8) {
                    const passable = this.getPassableDirections();
                    const sideDirs = passable.filter(d => d !== this.getOpposite(this.direction));
                    if (sideDirs.length > 0) {
                        this.snapToGrid();
                        this.direction = this.pickBestDirection(sideDirs, this.getBaseDirection());
                        this.stuckFrames = 0;
                    }
                }
            } else {
                this.snapToGrid();
                const passable = this.getPassableDirections();
                const noReverse = passable.filter(d => d !== this.getOpposite(this.direction));
                const candidates = noReverse.length > 0 ? noReverse : passable;

                if (candidates.length > 0) {
                    this.direction = this.pickBestDirection(candidates, this.getBaseDirection());
                } else {
                    this.direction = this.getOpposite(this.direction);
                }
                this.stuckFrames = 0;
            }

            if (this.stuckFrames >= 20) {
                this.snapToGrid();
                const passable = this.getPassableDirections();
                const noReverse = passable.filter(d => d !== this.direction && d !== this.getOpposite(this.direction));
                if (noReverse.length > 0) {
                    this.direction = noReverse[Math.floor(Math.random() * noReverse.length)];
                } else if (passable.length > 0) {
                    this.direction = passable[Math.floor(Math.random() * passable.length)];
                }
                this.stuckFrames = 0;
            }
        }
    }

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

    private handleShooting() {
        const map = this.gameManager.getMap();
        const col = Math.floor((this.x + this.w / 2) / CELL_SIZE);
        const row = Math.floor((this.y + this.h / 2) / CELL_SIZE);

        let hasWallOrBaseAhead = false;
        let hasTargetAhead = false;

        for (let step = 1; step <= 8; step++) {
            let checkR = row, checkC = col;
            if (this.direction === Direction.UP) checkR = row - step;
            else if (this.direction === Direction.DOWN) checkR = row + step;
            else if (this.direction === Direction.LEFT) checkC = col - step;
            else if (this.direction === Direction.RIGHT) checkC = col + step;

            const type = map.getTerrainType(checkR, checkC);
            if (type === 1 || type === 2 || type === 6) {
                hasWallOrBaseAhead = true;
                break;
            }
        }

        const player = this.gameManager.getPlayer();
        if (player && !player.isDead) {
            const pCol = Math.floor((player.x + player.w / 2) / CELL_SIZE);
            const pRow = Math.floor((player.y + player.h / 2) / CELL_SIZE);

            if (this.direction === Direction.UP && col === pCol && player.y < this.y) hasTargetAhead = true;
            else if (this.direction === Direction.DOWN && col === pCol && player.y > this.y) hasTargetAhead = true;
            else if (this.direction === Direction.LEFT && row === pRow && player.x < this.x) hasTargetAhead = true;
            else if (this.direction === Direction.RIGHT && row === pRow && player.x > this.x) hasTargetAhead = true;
        }

        const baseCoords = map.baseCoords;
        for (const base of baseCoords) {
            if (this.direction === Direction.UP && (col === base.c || col === base.c + 1) && base.r < row) hasTargetAhead = true;
            else if (this.direction === Direction.DOWN && (col === base.c || col === base.c + 1) && base.r > row) hasTargetAhead = true;
            else if (this.direction === Direction.LEFT && (row === base.r || row === base.r + 1) && base.c < col) hasTargetAhead = true;
            else if (this.direction === Direction.RIGHT && (row === base.r || row === base.r + 1) && base.c > col) hasTargetAhead = true;
        }

        let shootChance = 0.015;
        if (hasWallOrBaseAhead) shootChance = 0.15;
        else if (hasTargetAhead) shootChance = 0.25;

        if (Math.random() < shootChance) {
            this.shoot();
        }
    }

    private recoverFromStuck() {
        this.snapToGrid();
        // 1. Try to blast through whatever might be in the way
        this.shoot();

        // 2. Pick a new random passable direction that isn't the current one or its opposite
        const passable = this.getPassableDirections();
        const choices = passable.filter(d => d !== this.direction && d !== this.getOpposite(this.direction));

        if (choices.length > 0) {
            this.direction = choices[Math.floor(Math.random() * choices.length)];
        } else if (passable.length > 0) {
            this.direction = passable[Math.floor(Math.random() * passable.length)];
        } else {
            // Absolute last resort: just flip around
            this.direction = this.getOpposite(this.direction);
        }

        this.stuckFrames = 0;
        this.positionQuietFrames = 0;
    }

    public render(ctx: CanvasRenderingContext2D) {
        if (!this.hasSpawned) {
            // Draw spawn animation (flashing star)
            ctx.fillStyle = (this.spawnTimer % 8 < 4) ? '#fff' : '#888';
            ctx.fillRect(this.x, this.y, this.w, this.h);
            return;
        }

        // Determine color
        let color = '#fff'; // Basic
        if (this.grade === TankGrade.FAST) color = '#bbb';
        else if (this.grade === TankGrade.POWER) color = '#666';
        else if (this.grade === TankGrade.ARMOR) {
            if (this.hitFlashActive) {
                color = '#fff'; // White flash
            } else {
                if (this.hp === 4) color = '#0066ff'; // Strong blue
                else if (this.hp === 3) color = '#5577bb'; // Muted blue
                else if (this.hp === 2) color = '#888899'; // Very faded blue
                else color = '#aaaaaa'; // Plain gray
            }
        }

        // Flashing if holds powerup
        if (this.holdsPowerUp && Math.floor(Date.now() / 150) % 2 === 0) {
            color = '#f0f'; // Purple or bright color to indicate powerup
        }

        // Rely on base class render with specific color (update Tank.ts to support custom colors)
        this.colorOverride = color;
        super.render(ctx);
    }
}
