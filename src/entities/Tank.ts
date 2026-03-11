import { Entity } from './Entity';
import { Bullet } from './Bullet';
import { Direction, TankFaction, TankGrade } from '../types';
import { GameManager } from '../engine/GameManager';
import { TANK_SIZE, BATTLE_AREA_X, BATTLE_AREA_Y } from '../constants';

export abstract class Tank extends Entity {
    public direction: Direction = Direction.UP;
    public grade: TankGrade = TankGrade.BASIC;
    public faction: TankFaction = TankFaction.ENEMY;
    public hp: number = 1;

    public hasShield: boolean = false;
    public shieldTimer: number = 0;


    public speed: number = 1.5;
    public iceSlideFrames: number = 0;
    public iceSlideDir: Direction = Direction.UP;

    public bulletSpeed: number = 4;
    public bulletPower: number = 1;
    public maxBulletsOnScreen: number = 1;
    public shootCooldown: number = 20;
    public currentCooldown: number = 0;

    protected colorOverride: string = '';

    constructor(gameManager: GameManager) {
        super(gameManager, TANK_SIZE, TANK_SIZE);
    }

    public abstract applyDamage(): void;

    public shoot(): Bullet | null {
        if (this.currentCooldown > 0) return null;

        const activeBullets = this.gameManager.getBulletCountByOwner(this);
        if (activeBullets >= this.maxBulletsOnScreen) return null;

        this.currentCooldown = this.shootCooldown;
        const bullet = new Bullet(this.gameManager, this);

        // Position bullet based on tank direction
        if (this.direction === Direction.UP) {
            bullet.x = this.x + this.w / 2 - bullet.w / 2;
            bullet.y = this.y - bullet.h;
        } else if (this.direction === Direction.DOWN) {
            bullet.x = this.x + this.w / 2 - bullet.w / 2;
            bullet.y = this.y + this.h;
        } else if (this.direction === Direction.LEFT) {
            bullet.x = this.x - bullet.w;
            bullet.y = this.y + this.h / 2 - bullet.h / 2;
        } else if (this.direction === Direction.RIGHT) {
            bullet.x = this.x + this.w;
            bullet.y = this.y + this.h / 2 - bullet.h / 2;
        }

        this.gameManager.addBullet(bullet);
        this.gameManager.getSoundManager().playShoot();
        return bullet;
    }

    protected updateCooldowns(dt: number) {
        if (this.currentCooldown > 0) {
            this.currentCooldown -= dt; // 1 logical frame = 1 dt
        }
        if (this.shieldTimer > 0) {
            this.shieldTimer -= dt;
            if (this.shieldTimer <= 0) {
                this.hasShield = false;
            }
        }
        // Collision damage cooldown
        if ((this as any)._collisionDmgCd > 0) {
            (this as any)._collisionDmgCd -= dt;
        }
    }

    public render(ctx: CanvasRenderingContext2D): void {
        if (this.isDead) return;
        const screenX = this.x + BATTLE_AREA_X;
        const screenY = this.y + BATTLE_AREA_Y;

        // Draw Shield (glowing energy bubble)
        if (this.hasShield) {
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 100);
            const shieldAlpha = 0.15 + 0.15 * pulse;
            const radius = this.w * 0.7 + 2 * pulse;
            const cx = screenX + this.w / 2;
            const cy = screenY + this.h / 2;

            ctx.save();
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 12 + 6 * pulse;
            ctx.strokeStyle = `rgba(0, 212, 255, ${0.4 + 0.3 * pulse})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = `rgba(0, 212, 255, ${shieldAlpha})`;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        ctx.save();
        ctx.translate(screenX + this.w / 2, screenY + this.h / 2);

        // Rotate based on direction
        if (this.direction === Direction.RIGHT) ctx.rotate(Math.PI / 2);
        else if (this.direction === Direction.DOWN) ctx.rotate(Math.PI);
        else if (this.direction === Direction.LEFT) ctx.rotate(-Math.PI / 2);

        // ── Color Palette ──
        const isPlayer = this.faction === TankFaction.PLAYER;
        let mainColor: string, darkColor: string, lightColor: string, accentColor: string;

        if (isPlayer) {
            mainColor = '#22c55e';     // Vibrant neon green
            darkColor = '#16a34a';     // Deep but bright green
            lightColor = '#4ade80';    // Very bright highlight green
            accentColor = '#bbf7d0';   // Almost white-green for extreme shine

        } else if (this.colorOverride) {
            mainColor = this.colorOverride;
            // Derive dark/light from override
            darkColor = this.colorOverride;
            lightColor = this.colorOverride;
            accentColor = this.colorOverride;
        } else {
            mainColor = '#888';
            darkColor = '#555';
            lightColor = '#bbb';
            accentColor = '#ddd';
        }

        const w = this.w;
        const h = this.h;

        // Animated tread offset (rolling effect)
        const treadOffset = Math.floor(Date.now() / 80) % 6;

        // ═══ 1. TRACKS ═══
        const trackW = w * 0.22;
        const trackLX = -w / 2;
        const trackRX = w / 2 - trackW;
        const trackY = -h / 2;

        // Track base
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(trackLX, trackY, trackW, h);
        ctx.fillRect(trackRX, trackY, trackW, h);

        // Track color tint
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = darkColor;
        ctx.fillRect(trackLX, trackY, trackW, h);
        ctx.fillRect(trackRX, trackY, trackW, h);
        ctx.globalAlpha = 1.0;

        // Animated treads (rolling segments)
        ctx.fillStyle = 'rgba(60, 60, 60, 0.9)';
        for (let i = -1 + treadOffset; i < h; i += 6) {
            const ty = trackY + i;
            ctx.fillRect(trackLX + 1, ty, trackW - 2, 3);
            ctx.fillRect(trackRX + 1, ty, trackW - 2, 3);
        }
        // Tread highlights
        ctx.fillStyle = 'rgba(120, 120, 120, 0.4)';
        for (let i = -1 + treadOffset; i < h; i += 6) {
            const ty = trackY + i;
            ctx.fillRect(trackLX + 1, ty, trackW - 2, 1);
            ctx.fillRect(trackRX + 1, ty, trackW - 2, 1);
        }

        // Track drive wheels (circles at top and bottom)
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(trackLX + trackW / 2, trackY + 4, 3, 0, Math.PI * 2);
        ctx.arc(trackRX + trackW / 2, trackY + 4, 3, 0, Math.PI * 2);
        ctx.arc(trackLX + trackW / 2, trackY + h - 4, 3, 0, Math.PI * 2);
        ctx.arc(trackRX + trackW / 2, trackY + h - 4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#555';
        ctx.beginPath();
        ctx.arc(trackLX + trackW / 2, trackY + 4, 1.5, 0, Math.PI * 2);
        ctx.arc(trackRX + trackW / 2, trackY + 4, 1.5, 0, Math.PI * 2);
        ctx.arc(trackLX + trackW / 2, trackY + h - 4, 1.5, 0, Math.PI * 2);
        ctx.arc(trackRX + trackW / 2, trackY + h - 4, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Track outer edge bevels
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(trackLX, trackY, 1, h);
        ctx.fillRect(trackRX, trackY, 1, h);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(trackLX + trackW - 1, trackY, 1, h);
        ctx.fillRect(trackRX + trackW - 1, trackY, 1, h);

        // ═══ 2. HULL ═══
        const hullW = w * 0.56;
        const hullH = h * 0.78;
        const hullX = -hullW / 2;
        const hullY = -hullH / 2 + (h * 0.08);

        // Hull body
        ctx.fillStyle = mainColor;
        ctx.fillRect(hullX, hullY, hullW, hullH);

        // Hull 3D bevels
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(hullX, hullY, hullW, 2);        // Top highlight
        ctx.fillRect(hullX, hullY, 2, hullH);         // Left highlight
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(hullX, hullY + hullH - 2, hullW, 2);  // Bottom shadow
        ctx.fillRect(hullX + hullW - 2, hullY, 2, hullH);  // Right shadow

        // Inner hull panel (recessed)
        ctx.fillStyle = lightColor;
        ctx.fillRect(hullX + 4, hullY + 5, hullW - 8, hullH - 12);

        // Inner panel inset shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(hullX + 4, hullY + 5, hullW - 8, 1);
        ctx.fillRect(hullX + 4, hullY + 5, 1, hullH - 12);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(hullX + 4, hullY + hullH - 8, hullW - 8, 1);
        ctx.fillRect(hullX + hullW - 5, hullY + 5, 1, hullH - 12);

        // Engine exhaust vents (rear of tank)
        ctx.fillStyle = '#222';
        ctx.fillRect(hullX + 3, hullY + hullH - 6, 3, 4);
        ctx.fillRect(hullX + hullW - 6, hullY + hullH - 6, 3, 4);
        ctx.fillStyle = 'rgba(255,100,0,0.3)';
        ctx.fillRect(hullX + 3, hullY + hullH - 5, 3, 2);
        ctx.fillRect(hullX + hullW - 6, hullY + hullH - 5, 3, 2);

        // Rivets on hull corners
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        const rivetR = 1;
        ctx.beginPath();
        ctx.arc(hullX + 5, hullY + 4, rivetR, 0, Math.PI * 2);
        ctx.arc(hullX + hullW - 5, hullY + 4, rivetR, 0, Math.PI * 2);
        ctx.arc(hullX + 5, hullY + hullH - 4, rivetR, 0, Math.PI * 2);
        ctx.arc(hullX + hullW - 5, hullY + hullH - 4, rivetR, 0, Math.PI * 2);
        ctx.fill();

        // ═══ 3. BARREL ═══
        const barrelW = w * 0.14;
        const barrelH = h * 0.50;
        const barrelX = -barrelW / 2;
        const barrelY = -h / 2 - 4;

        // Barrel body
        ctx.fillStyle = '#667';
        ctx.fillRect(barrelX, barrelY, barrelW, barrelH);

        // Barrel cylindrical shading
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(barrelX, barrelY, Math.ceil(barrelW * 0.3), barrelH);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(barrelX + Math.floor(barrelW * 0.7), barrelY, Math.ceil(barrelW * 0.3), barrelH);

        // Barrel rings (reinforcement bands)
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(barrelX - 1, barrelY + barrelH * 0.3, barrelW + 2, 2);
        ctx.fillRect(barrelX - 1, barrelY + barrelH * 0.6, barrelW + 2, 2);

        // Muzzle brake (wider end)
        ctx.fillStyle = '#556';
        ctx.fillRect(barrelX - 2, barrelY, barrelW + 4, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(barrelX - 2, barrelY, barrelW + 4, 1);
        // Muzzle bore (dark hole)
        ctx.fillStyle = '#111';
        ctx.fillRect(barrelX + 1, barrelY, barrelW - 2, 2);

        // ═══ 4. TURRET ═══
        const turretR = w * 0.26;

        // Turret shadow on hull
        ctx.beginPath();
        ctx.arc(1.5, 3, turretR + 1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();

        // Turret base
        ctx.beginPath();
        ctx.arc(0, 0, turretR, 0, Math.PI * 2);
        ctx.fillStyle = mainColor;
        ctx.fill();

        // Turret dome gradient (lighting from top-left)
        const grad = ctx.createRadialGradient(
            -turretR * 0.3, -turretR * 0.3, turretR * 0.05,
            0, 0, turretR
        );
        grad.addColorStop(0, 'rgba(255,255,255,0.45)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, turretR, 0, Math.PI * 2);
        ctx.fill();

        // Turret ring outline
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Commander's hatch
        ctx.fillStyle = darkColor;
        ctx.beginPath();
        ctx.arc(1, 1.5, turretR * 0.32, 0, Math.PI * 2);
        ctx.fill();
        // Hatch cross
        ctx.strokeStyle = 'rgba(200,200,200,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(1 - turretR * 0.2, 1.5);
        ctx.lineTo(1 + turretR * 0.2, 1.5);
        ctx.moveTo(1, 1.5 - turretR * 0.2);
        ctx.lineTo(1, 1.5 + turretR * 0.2);
        ctx.stroke();
        // Hatch rim highlight
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(1, 1.5, turretR * 0.32, 0, Math.PI * 2);
        ctx.stroke();

        // ═══ 5. GRADE-SPECIFIC DETAILS ═══
        if (isPlayer && this.grade >= TankGrade.FAST) {
            // Speed stripes on hull sides
            ctx.fillStyle = accentColor;
            ctx.globalAlpha = 0.4;
            ctx.fillRect(hullX + 2, hullY + hullH * 0.3, 2, hullH * 0.4);
            ctx.fillRect(hullX + hullW - 4, hullY + hullH * 0.3, 2, hullH * 0.4);
            ctx.globalAlpha = 1.0;
        }
        if (isPlayer && this.grade >= TankGrade.POWER) {
            // Star emblem on turret
            ctx.fillStyle = accentColor;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const angle = -Math.PI / 2 + (i * 2 * Math.PI / 5);
                const px = Math.cos(angle) * 3;
                const py = Math.sin(angle) * 3;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        ctx.restore();
    }
}
