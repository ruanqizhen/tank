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


    private getCellCost(col: number, row: number): number {
        const t = this.map.getTerrainType(row, col);
        if (t === 1) return 10; // Brick cost
        if (t === 6) return 50; // Base cost (avoid unless necessary)
        if (t === 5) return 1.2; // Ice cost slightly higher
        return 1; // Empty/Forest
    }

    private getTankMoveCost(col: number, row: number): number {
        // Cost is the maximum cost among the 4 cells the tank occupies
        return Math.max(
            this.getCellCost(col, row),
            this.getCellCost(col + 1, row),
            this.getCellCost(col, row + 1),
            this.getCellCost(col + 1, row + 1)
        );
    }

    private isPassableForTank(col: number, row: number): boolean {
        // Out of bounds check for 2x2 footprint
        if (col < 0 || col >= GRID_COLS - 1 || row < 0 || row >= GRID_ROWS - 1) {
            return false;
        }

        // Steel (2) and Water (4) are remains impassable
        const check = (c: number, r: number) => {
            const t = this.map.getTerrainType(r, c);
            return t !== 2 && t !== 4;
        };

        return check(col, row) && check(col + 1, row) &&
            check(col, row + 1) && check(col + 1, row + 1);
    }

    private heuristic(ax: number, ay: number, bx: number, by: number): number {
        return Math.abs(bx - ax) + Math.abs(by - ay);
    }

    private getNeighbors(node: AStarNode): AStarNode[] {
        const neighbors: AStarNode[] = [];
        const { x, y } = node;
        const directions = [
            { dx: 0, dy: -1, dir: Direction.UP },
            { dx: 0, dy: 1, dir: Direction.DOWN },
            { dx: -1, dy: 0, dir: Direction.LEFT },
            { dx: 1, dy: 0, dir: Direction.RIGHT }
        ];

        for (const d of directions) {
            const nx = x + d.dx;
            const ny = y + d.dy;
            if (this.isPassableForTank(nx, ny)) {
                neighbors.push({ x: nx, y: ny, g: 0, h: 0, f: 0, parent: node });
            }
        }
        return neighbors;
    }

    public findPath(startCol: number, startRow: number, endCol: number, endRow: number): Direction[] {
        // Clamp end coordinates to valid 2x2 top-left bounds
        endCol = Math.max(0, Math.min(GRID_COLS - 2, endCol));
        endRow = Math.max(0, Math.min(GRID_ROWS - 2, endRow));

        const startNode: AStarNode = { x: startCol, y: startRow, g: 0, h: 0, f: 0, parent: null };
        const endNode: AStarNode = { x: endCol, y: endRow, g: 0, h: 0, f: 0, parent: null };

        if (!this.isPassableForTank(endCol, endRow)) {
            return [];
        }

        const openSet: AStarNode[] = [startNode];
        const closedSet: Set<string> = new Set();

        while (openSet.length > 0) {
            let current = openSet[0];
            let currentIndex = 0;

            for (let i = 1; i < openSet.length; i++) {
                if (openSet[i].f < current.f) {
                    current = openSet[i];
                    currentIndex = i;
                }
            }

            openSet.splice(currentIndex, 1);
            closedSet.add(`${current.x},${current.y}`);

            if (current.x === endNode.x && current.y === endNode.y) {
                const path: Direction[] = [];
                let node: AStarNode | null = current;
                while (node && node.parent) {
                    const dx = node.x - node.parent.x;
                    const dy = node.y - node.parent.y;
                    if (dx === 1) path.unshift(Direction.RIGHT);
                    else if (dx === -1) path.unshift(Direction.LEFT);
                    else if (dy === 1) path.unshift(Direction.DOWN);
                    else if (dy === -1) path.unshift(Direction.UP);
                    node = node.parent;
                }
                return path;
            }

            for (const neighbor of this.getNeighbors(current)) {
                const key = `${neighbor.x},${neighbor.y}`;
                if (closedSet.has(key)) continue;

                // Use weighted cost for movement
                const moveCost = this.getTankMoveCost(neighbor.x, neighbor.y);
                const g = current.g + moveCost;
                const h = this.heuristic(neighbor.x, neighbor.y, endNode.x, endNode.y);
                const f = g + h;

                const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (!existing) {
                    neighbor.g = g;
                    neighbor.h = h;
                    neighbor.f = f;
                    openSet.push(neighbor);
                } else if (g < existing.g) {
                    existing.g = g;
                    existing.f = f;
                    existing.parent = current;
                }
            }
        }

        return [];
    }

    public findPathToPlayer(startCol: number, startRow: number, playerCol: number, playerRow: number): Direction[] {
        return this.findPath(startCol, startRow, playerCol, playerRow);
    }

    public findPathToBase(startCol: number, startRow: number): Direction[] {
        const baseCoords = this.map.baseCoords;
        if (baseCoords.length === 0) {
            return this.findPath(startCol, startRow, GRID_COLS / 2 - 1, GRID_ROWS - 2);
        }

        let bestPath: Direction[] = [];
        let bestDist = Infinity;

        for (const base of baseCoords) {
            const path = this.findPath(startCol, startRow, base.c, base.r);
            if (path.length > 0) {
                const dist = path.length;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPath = path;
                }
            }
        }

        return bestPath;
    }
}
