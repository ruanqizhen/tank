import { Tank } from './Tank';
import { TankGrade, TankFaction, Direction } from '../types';
import { GameManager } from '../engine/GameManager';
import { CELL_SIZE, BATTLE_AREA_X, BATTLE_AREA_Y } from '../constants';

export class PlayerTank extends Tank {
    public lives: number = 3;
    public score: number = 0;
    public isMax: boolean = false;

    private slideTimer: number = 0;
    private maxSlideTime: number = 20; // frames to slide
    private lastDx: number = 0;
    private lastDy: number = 0;

    private wasLeftMouseDown: boolean = false;
    private isDragging: boolean = false;
    private isAutoShooting: boolean = false;
    private dragTarget: { x: number, y: number } | null = null;
    private dragOffset: { x: number, y: number } | null = null;

    private isAlignedToGrid(): boolean {
        // Tank is aligned if both x and y are multiples of CELL_SIZE (20)
        const mx = Math.abs(this.x % CELL_SIZE);
        const my = Math.abs(this.y % CELL_SIZE);
        const alignedX = mx < 0.1 || mx > CELL_SIZE - 0.1;
        const alignedY = my < 0.1 || my > CELL_SIZE - 0.1;
        return alignedX && alignedY;
    }

    private snapToGrid() {
        this.x = Math.round(this.x / CELL_SIZE) * CELL_SIZE;
        this.y = Math.round(this.y / CELL_SIZE) * CELL_SIZE;
    }

    constructor(gameManager: GameManager) {
        super(gameManager);
        this.faction = TankFaction.PLAYER;
        this.respawn();
    }

    public respawn() {
        const spawnPos = this.gameManager.getMap().getPlayerSpawn();
        this.x = spawnPos.c * CELL_SIZE;
        this.y = spawnPos.r * CELL_SIZE;
        this.direction = Direction.UP;
        this.grade = TankGrade.BASIC;
        this.isMax = false;
        this.updateStats();

        this.hasShield = true;
        this.shieldTimer = 180;
        this.isDead = false;
    }

    public respawnWithGrade(grade: TankGrade, isMax: boolean) {
        const spawnPos = this.gameManager.getMap().getPlayerSpawn();
        this.x = spawnPos.c * CELL_SIZE;
        this.y = spawnPos.r * CELL_SIZE;
        this.direction = Direction.UP;
        this.grade = grade;
        this.isMax = isMax;
        this.updateStats();

        this.hasShield = true;
        this.shieldTimer = 180;
        this.isDead = false;
    }

    public applyDamage() {
        if (this.hasShield) {
            return;
        }

        if (this.isMax) {
            this.grade = TankGrade.POWER;
            this.isMax = false;
            this.updateStats();
            return;
        }

        if (this.grade > TankGrade.BASIC) {
            this.grade--;
            this.updateStats();
            return;
        }

        // Death
        this.lives--;
        this.isDead = true;
        this.gameManager.getParticleSystem().emitExplosion(this.x + this.w / 2, this.y + this.h / 2, 50, '#fa2');

        if (this.lives >= 0) {
            this.gameManager.schedulePlayerRespawn();
        } else {
            this.gameManager.triggerGameOver();
        }
    }

    public giveShield(duration: number) {
        this.hasShield = true;
        this.shieldTimer = duration;
    }

    public upgrade(newGrade: TankGrade) {
        this.grade = newGrade;
        if (newGrade === TankGrade.ARMOR) {
            this.isMax = true;
        }
        this.updateStats();
    }

    private updateStats() {
        const effectiveGrade = this.isMax ? TankGrade.ARMOR : this.grade;

        // Base stats
        this.speed = effectiveGrade === TankGrade.FAST ? 2.5 : 1.5;
        this.bulletPower = (effectiveGrade >= TankGrade.POWER) ? 2 : 1;

        // Progressive shooting mechanics
        // 0.5s initial interval (50 frames at 60fps), reduced by 20% per level
        this.shootCooldown = Math.round(50 * Math.pow(0.8, effectiveGrade - 1));

        // Initial bullet speed 4, increased by 10% per level
        this.bulletSpeed = 4 * Math.pow(1.1, effectiveGrade - 1);

        // Remove the "only one bullet" restriction (set to 6, which is plenty for the cadence)
        this.maxBulletsOnScreen = 6;
    }

    public update(dt: number) {
        if (this.isDead) return;
        this.updateCooldowns(dt);

        const inputSystem = this.gameManager.getInputManager();
        const action = inputSystem.getActionState();

        let isMoving = false;
        let dx = 0;
        let dy = 0;

        const isLeftDown = inputSystem.isLeftClickHeld();
        const mousePos = inputSystem.getMouseLogicalPos();

        // 1. Mouse State Machine (Drag vs AutoShoot)
        if (isLeftDown) {
            const mx = mousePos.x - BATTLE_AREA_X;
            const my = mousePos.y - BATTLE_AREA_Y;

            if (!this.wasLeftMouseDown) {
                // Check if click is near the tank (expanded hitbox by 10px each side for easier grabbing)
                const hitMargin = 10;
                if (mx >= this.x - hitMargin && mx <= this.x + this.w + hitMargin &&
                    my >= this.y - hitMargin && my <= this.y + this.h + hitMargin) {
                    this.isDragging = true;
                    this.isAutoShooting = false;
                    const cx = this.x + this.w / 2;
                    const cy = this.y + this.h / 2;
                    this.dragOffset = { x: cx - mx, y: cy - my };
                    this.dragTarget = { x: cx, y: cy };
                } else {
                    // Clicked elsewhere on map. Start auto-shooting, but DON'T clear dragging!
                    this.isAutoShooting = true;
                    // If we weren't already dragging something, there's no active drag target anyway.
                }
            } else if (this.isDragging && this.dragOffset && !this.isAutoShooting) {
                this.dragTarget = { x: mx + this.dragOffset.x, y: my + this.dragOffset.y };
            }
        } else {
            this.isAutoShooting = false;
            // Note: We don't clear isDragging or dragTarget here, allowing the tank to finish its movement.
        }
        this.wasLeftMouseDown = isLeftDown;

        // 2. Keyboard movement — separate "turning" from "translating"
        let rawDirection: Direction | null = null;  // What direction the user WANTS to face
        let wantsToMove = false;

        const aligned = this.isAlignedToGrid();

        if (action.up) { rawDirection = Direction.UP; wantsToMove = true; }
        else if (action.down) { rawDirection = Direction.DOWN; wantsToMove = true; }
        else if (action.left) { rawDirection = Direction.LEFT; wantsToMove = true; }
        else if (action.right) { rawDirection = Direction.RIGHT; wantsToMove = true; }

        // Clear drag states if keyboard is taking over
        if (wantsToMove) {
            this.isDragging = false;
            this.isAutoShooting = false;
            this.dragTarget = null;
            this.dragOffset = null;
        }

        // The direction that the tank will actually TRANSLATE towards
        let moveDirection = this.direction;
        let justTurned = false;

        // Decrement turn delay timer
        if ((this as any)._turnDelayTimer > 0) {
            (this as any)._turnDelayTimer -= dt;
        }

        // STEP A: Handle turning and movement delay
        if (rawDirection !== null) {
            if (rawDirection !== this.direction) {
                this.direction = rawDirection;
                // Set an 8 frame delay (~133ms) before movement is allowed, making the turn perceptible
                (this as any)._turnDelayTimer = 8;
                wantsToMove = false;
                justTurned = true;
            } else {
                // Direction matches. Check if we are still in the turn delay period
                if ((this as any)._turnDelayTimer > 0) {
                    wantsToMove = false;
                    justTurned = true; // Still treating as "turning" to prevent grid-snap slipping
                } else {
                    // Turn delay finished, user wants to move forward
                    moveDirection = rawDirection;
                }
            }
        } else {
            // Reset delay instantly if user releases all keys
            (this as any)._turnDelayTimer = 0;
        }

        let wantsToShoot = action.shoot;

        // 3. Mouse Drag Movement
        if (!wantsToMove && !justTurned && this.isDragging && this.dragTarget) {
            const cx = this.x + this.w / 2;
            const cy = this.y + this.h / 2;
            const deltaX = this.dragTarget.x - cx;
            const deltaY = this.dragTarget.y - cy;
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                let rawDragDir = this.direction;
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    rawDragDir = deltaX > 0 ? Direction.RIGHT : Direction.LEFT;
                } else {
                    rawDragDir = deltaY > 0 ? Direction.DOWN : Direction.UP;
                }

                if (!aligned) {
                    moveDirection = this.direction;
                } else {
                    moveDirection = rawDragDir;
                }
                wantsToMove = true;
            } else {
                if (!inputSystem.isLeftClickHeld()) {
                    this.isDragging = false;
                    this.dragTarget = null;
                }
            }
        }

        // 3.5 Auto-align if no input and NOT actively holding a drag position
        // Skip this on turn frames to prevent movement on the same frame as a turn
        if (!wantsToMove && !justTurned && !this.isDragging) {
            if (!aligned) {
                wantsToMove = true;

                const mx = Math.abs(this.x % CELL_SIZE);
                const my = Math.abs(this.y % CELL_SIZE);
                const alignedX = mx < 0.1 || mx > CELL_SIZE - 0.1;
                const alignedY = my < 0.1 || my > CELL_SIZE - 0.1;

                if (!alignedX && !alignedY) {
                    moveDirection = this.direction;
                } else if (!alignedX) {
                    moveDirection = (this.direction === Direction.LEFT || this.direction === Direction.RIGHT)
                        ? this.direction
                        : (mx < CELL_SIZE / 2 ? Direction.LEFT : Direction.RIGHT);
                } else if (!alignedY) {
                    moveDirection = (this.direction === Direction.UP || this.direction === Direction.DOWN)
                        ? this.direction
                        : (my < CELL_SIZE / 2 ? Direction.UP : Direction.DOWN);
                }
            } else {
                this.snapToGrid();
            }
        }

        // 4. Mouse Auto Shooting Setup
        if (this.isAutoShooting) {
            const mx = mousePos.x - BATTLE_AREA_X;
            const my = mousePos.y - BATTLE_AREA_Y;
            const cx = this.x + this.w / 2;
            const cy = this.y + this.h / 2;
            const deltaX = mx - cx;
            const deltaY = my - cy;

            let targetDir = this.direction;
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    targetDir = deltaX > 0 ? Direction.RIGHT : Direction.LEFT;
                } else {
                    targetDir = deltaY > 0 ? Direction.DOWN : Direction.UP;
                }
            }

            if (this.direction !== targetDir) {
                this.direction = targetDir;
            } else {
                wantsToShoot = true;
            }
        }

        if (wantsToMove) {
            if (!this.isAutoShooting && this.direction !== moveDirection) {
                // Need to face the movement direction first (e.g. auto-align snap)
                this.direction = moveDirection;
            } else {
                isMoving = true;
                if (moveDirection === Direction.UP) dy = -this.speed;
                else if (moveDirection === Direction.DOWN) dy = this.speed;
                else if (moveDirection === Direction.LEFT) dx = -this.speed;
                else if (moveDirection === Direction.RIGHT) dx = this.speed;
            }
        }

        // Remaining handlers code replaced natively above

        // 5. Slipping on Ice (if not intentionally moving)
        if (!isMoving) {
            // Are we on ice?
            const tankBox = { x: this.x, y: this.y, w: this.w, h: this.h };
            const terrainHits = this.gameManager.getCollisionSystem().queryTerrain(tankBox);
            const onIce = terrainHits.some(cell => cell.type === 5);

            if (onIce && this.slideTimer > 0) {
                isMoving = true;
                dx = this.lastDx;
                dy = this.lastDy;
                this.slideTimer--;
            } else {
                this.slideTimer = 0;
            }
        } else {
            // We are intentionally moving, reset the slide timer and remember direction
            this.slideTimer = this.maxSlideTime;
            this.lastDx = dx;
            this.lastDy = dy;
        }

        if (isMoving) {
            // Apply speed perfectly so we don't overshoot grid bounds if we are close
            if (!aligned && wantsToMove) {
                const mx = this.x % CELL_SIZE;
                const my = this.y % CELL_SIZE;

                // Check if user intends to drive exactly straight
                let userWantsStraight = false;
                if (this.direction === Direction.UP && action.up) userWantsStraight = true;
                else if (this.direction === Direction.DOWN && action.down) userWantsStraight = true;
                else if (this.direction === Direction.LEFT && action.left) userWantsStraight = true;
                else if (this.direction === Direction.RIGHT && action.right) userWantsStraight = true;
                else if (this.isDragging && this.dragTarget) {
                    const deltaX = this.dragTarget.x - (this.x + this.w / 2);
                    const deltaY = this.dragTarget.y - (this.y + this.h / 2);
                    if (Math.abs(deltaX) > Math.abs(deltaY)) {
                        if (this.direction === Direction.RIGHT && deltaX > 0) userWantsStraight = true;
                        if (this.direction === Direction.LEFT && deltaX < 0) userWantsStraight = true;
                    } else {
                        if (this.direction === Direction.DOWN && deltaY > 0) userWantsStraight = true;
                        if (this.direction === Direction.UP && deltaY < 0) userWantsStraight = true;
                    }
                }

                // If they don't explicitly want to drive straight into the next block, snap exactly against the edge.
                if (!userWantsStraight) {
                    if (dy < 0) dy = -Math.min(Math.abs(dy), my < 0.1 ? 0 : my);
                    else if (dy > 0) dy = Math.min(dy, CELL_SIZE - my);

                    if (dx < 0) dx = -Math.min(Math.abs(dx), mx < 0.1 ? 0 : mx);
                    else if (dx > 0) dx = Math.min(dx, CELL_SIZE - mx);
                }
            }

            // Pass requested movement to collision system
            const res = this.gameManager.getCollisionSystem().resolveMovement(this, dx, dy);

            // If we hit a wall while auto-moving, stop trying
            if (res.dx === 0 && res.dy === 0 && !action.up && !action.down && !action.left && !action.right) {
                if (!inputSystem.isLeftClickHeld()) {
                    this.isDragging = false;
                    this.dragTarget = null;
                }
                this.snapToGrid(); // Snap to wall boundary
            }

            this.x += res.dx;
            this.y += res.dy;
        }

        // 6. Execute Shooting
        if (wantsToShoot) {
            this.shoot();
        }
    }
}
