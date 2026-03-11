import { Direction } from '../types';
import { MapTerrain } from '../world/Map';
import { GRID_COLS, GRID_ROWS } from '../constants';

interface AStarNode {
    x: number;
    y: number;
    g: number;
    h: number;
    f: number;
    parent: AStarNode | null;
}

export class AStarPathfinder {
    private map: MapTerrain;

    constructor(map: MapTerrain) {
        this.map = map;
    }

    /**
     * Returns the movement cost for a single cell.
     * @param bulletPower - the tank's bullet power (1 or 2)
     *   - Brick: costs proportional to time-to-destroy (shootCooldown frames per shot)
     *   - Steel: impassable for power-1, costly for power-2
     *   - Water: impassable
     *   - Base: very high cost (should never path through base!)
     */
    private getCellCost(col: number, row: number, bulletPower: number): number {
        const t = this.map.getTerrainType(row, col);
        switch (t) {
            case 0: return 1;   // Empty
            case 1: return 5;   // Brick — ~equivalent to 5 steps of detour
            case 2:             // Steel
                return bulletPower >= 2 ? 8 : Infinity;
            case 3: return 1;   // Forest (passable, just hides)
            case 4: return Infinity; // Water — impassable
            case 5: return 1.5; // Ice — slightly costly (slippery)
            case 6: return Infinity; // Base — NEVER path through base
            default: return 1;
        }
    }

    /**
     * Cost for a 2×2 tank footprint at (col, row).
     * Returns the max cost among the 4 cells.
     */
    private getTankMoveCost(col: number, row: number, bulletPower: number): number {
        const c1 = this.getCellCost(col, row, bulletPower);
        const c2 = this.getCellCost(col + 1, row, bulletPower);
        const c3 = this.getCellCost(col, row + 1, bulletPower);
        const c4 = this.getCellCost(col + 1, row + 1, bulletPower);
        return Math.max(c1, c2, c3, c4);
    }

    /**
     * A 2×2 tank can move to (col, row) if cost is finite.
     */
    private isPassableForTank(col: number, row: number, bulletPower: number): boolean {
        if (col < 0 || col >= GRID_COLS - 1 || row < 0 || row >= GRID_ROWS - 1) {
            return false;
        }
        return this.getTankMoveCost(col, row, bulletPower) < Infinity;
    }

    private heuristic(ax: number, ay: number, bx: number, by: number): number {
        return Math.abs(bx - ax) + Math.abs(by - ay);
    }

    private getNeighbors(node: AStarNode, bulletPower: number): AStarNode[] {
        const neighbors: AStarNode[] = [];
        const dirs = [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 }
        ];

        for (const d of dirs) {
            const nx = node.x + d.dx;
            const ny = node.y + d.dy;
            if (this.isPassableForTank(nx, ny, bulletPower)) {
                neighbors.push({ x: nx, y: ny, g: 0, h: 0, f: 0, parent: node });
            }
        }
        return neighbors;
    }

    /**
     * Find a weighted path from (startCol, startRow) to (endCol, endRow).
     * @param bulletPower - the tank's bullet power, used to compute terrain costs
     * @returns array of Directions, or empty if no path
     */
    public findPath(startCol: number, startRow: number, endCol: number, endRow: number, bulletPower: number = 1): Direction[] {
        endCol = Math.max(0, Math.min(GRID_COLS - 2, endCol));
        endRow = Math.max(0, Math.min(GRID_ROWS - 2, endRow));

        const startNode: AStarNode = { x: startCol, y: startRow, g: 0, h: 0, f: 0, parent: null };

        if (!this.isPassableForTank(endCol, endRow, bulletPower)) {
            // Try to get as close as possible by finding a neighbor that is passable
            // This handles the case where the target is inside a wall
            return [];
        }

        const openSet: AStarNode[] = [startNode];
        const closedSet: Set<string> = new Set();
        const maxIterations = 800; // Safety cap for large maps
        let iterations = 0;

        while (openSet.length > 0 && iterations < maxIterations) {
            iterations++;

            // Find the node with the lowest f
            let bestIdx = 0;
            for (let i = 1; i < openSet.length; i++) {
                if (openSet[i].f < openSet[bestIdx].f) {
                    bestIdx = i;
                }
            }
            const current = openSet[bestIdx];
            openSet.splice(bestIdx, 1);

            const key = `${current.x},${current.y}`;
            if (closedSet.has(key)) continue;
            closedSet.add(key);

            // Goal check
            if (current.x === endCol && current.y === endRow) {
                return this.reconstructPath(current);
            }

            for (const neighbor of this.getNeighbors(current, bulletPower)) {
                const nKey = `${neighbor.x},${neighbor.y}`;
                if (closedSet.has(nKey)) continue;

                const moveCost = this.getTankMoveCost(neighbor.x, neighbor.y, bulletPower);
                const g = current.g + moveCost;
                const h = this.heuristic(neighbor.x, neighbor.y, endCol, endRow);
                const f = g + h;

                const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (!existing) {
                    neighbor.g = g;
                    neighbor.h = h;
                    neighbor.f = f;
                    openSet.push(neighbor);
                } else if (g < existing.g) {
                    existing.g = g;
                    existing.f = g + existing.h;
                    existing.parent = current;
                }
            }
        }

        return []; // No path found
    }

    private reconstructPath(node: AStarNode): Direction[] {
        const path: Direction[] = [];
        let current: AStarNode | null = node;
        while (current && current.parent) {
            const dx = current.x - current.parent.x;
            const dy = current.y - current.parent.y;
            if (dx === 1) path.unshift(Direction.RIGHT);
            else if (dx === -1) path.unshift(Direction.LEFT);
            else if (dy === 1) path.unshift(Direction.DOWN);
            else if (dy === -1) path.unshift(Direction.UP);
            current = current.parent;
        }
        return path;
    }

    public findPathToBase(startCol: number, startRow: number, bulletPower: number = 1): Direction[] {
        const baseCoords = this.map.baseCoords;
        if (baseCoords.length === 0) {
            return this.findPath(startCol, startRow, Math.floor(GRID_COLS / 2) - 1, GRID_ROWS - 2, bulletPower);
        }

        // Path to the row ABOVE the base (attack position), not INTO the base
        let bestPath: Direction[] = [];
        let bestCost = Infinity;

        for (const base of baseCoords) {
            // Try positions around the base (above, left, right)
            const attackPositions = [
                { c: base.c, r: base.r - 2 },     // above
                { c: base.c - 2, r: base.r },      // left
                { c: base.c + 2, r: base.r },      // right
            ];

            for (const pos of attackPositions) {
                const path = this.findPath(startCol, startRow, pos.c, pos.r, bulletPower);
                if (path.length > 0 && path.length < bestCost) {
                    bestCost = path.length;
                    bestPath = path;
                }
            }
        }

        return bestPath;
    }

    public findPathToPlayer(startCol: number, startRow: number, playerCol: number, playerRow: number, bulletPower: number = 1): Direction[] {
        return this.findPath(startCol, startRow, playerCol, playerRow, bulletPower);
    }

    /**
     * Check if the next step in a direction has a destructible obstacle (brick, or steel for power-2).
     */
    public isDestructibleAhead(col: number, row: number, dir: Direction, bulletPower: number): boolean {
        const map = this.map;
        const check = (r: number, c: number): boolean => {
            const t = map.getTerrainType(r, c);
            if (t === 1) return true; // Brick always destructible
            if (t === 2 && bulletPower >= 2) return true; // Steel for power-2
            return false;
        };

        switch (dir) {
            case Direction.UP:    return check(row - 1, col) || check(row - 1, col + 1);
            case Direction.DOWN:  return check(row + 2, col) || check(row + 2, col + 1);
            case Direction.LEFT:  return check(row, col - 1) || check(row + 1, col - 1);
            case Direction.RIGHT: return check(row, col + 2) || check(row + 1, col + 2);
        }
    }
}
