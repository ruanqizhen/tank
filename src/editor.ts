import { CELL_SIZE, GRID_COLS, GRID_ROWS } from './constants';

class MapEditor {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private terrain: number[][] = [];
    private selectedType: number = 1;
    private isDragging: boolean = false;
    private lastClickedCell: { r: number, c: number } | null = null;

    constructor() {
        this.canvas = document.getElementById('editorCanvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        
        // Initialize grid
        this.initGrid();
        
        // Setup events
        this.setupPalette();
        this.setupMouseEvents();
        this.setupButtons();
        
        // Initial render
        this.render();
    }

    private initGrid() {
        this.terrain = [];
        for (let r = 0; r < GRID_ROWS; r++) {
            this.terrain[r] = new Array(GRID_COLS).fill(0);
        }
    }

    private setupPalette() {
        const items = document.querySelectorAll('.palette-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                items.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.selectedType = parseInt(item.getAttribute('data-type') || '1');
            });
        });
    }

    private setupMouseEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.handleMouseAction(e);
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.lastClickedCell = null;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.handleMouseAction(e);
            }
        });

        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    private handleMouseAction(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const col = Math.floor(x / CELL_SIZE);
        const row = Math.floor(y / CELL_SIZE);
        
        if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return;

        // If it's a new cell in this drag sequence
        if (!this.lastClickedCell || this.lastClickedCell.r !== row || this.lastClickedCell.c !== col) {
            // Toggle logic: if clicking on the same type, clear it. 
            // EXCEPT during dragging (where we just want to paint)
            if (!this.isDragging || !this.lastClickedCell) {
                 if (this.terrain[row][col] === this.selectedType) {
                    this.terrain[row][col] = 0;
                } else {
                    this.terrain[row][col] = this.selectedType;
                }
            } else {
                // Dragging: just set to selected type
                this.terrain[row][col] = this.selectedType;
            }
            
            this.lastClickedCell = { r: row, c: col };
            this.render();
        }
    }

    private setupButtons() {
        const copyBtn = document.getElementById('copy-btn');
        copyBtn?.addEventListener('click', () => {
            const data = this.terrain.map(row => row.join('')).join('\n');
            navigator.clipboard.writeText(data).then(() => {
                const originalText = copyBtn.innerText;
                copyBtn.innerText = '已复制!';
                copyBtn.style.background = '#0f0';
                setTimeout(() => {
                    copyBtn.innerText = originalText;
                    copyBtn.style.background = '';
                }, 2000);
            });
        });

        const loadBtn = document.getElementById('load-btn');
        const modal = document.getElementById('load-modal');
        const levelInput = document.getElementById('level-input') as HTMLTextAreaElement;
        const confirmBtn = document.getElementById('confirm-load');
        const cancelBtn = document.getElementById('cancel-load');

        loadBtn?.addEventListener('click', () => {
            modal?.classList.remove('hidden');
        });

        cancelBtn?.addEventListener('click', () => {
            modal?.classList.add('hidden');
        });

        confirmBtn?.addEventListener('click', () => {
            const lines = levelInput.value.trim().split('\n');
            if (lines.length === GRID_ROWS) {
                for (let r = 0; r < GRID_ROWS; r++) {
                    const chars = lines[r].trim().split('');
                    if (chars.length === GRID_COLS) {
                        for (let c = 0; c < GRID_COLS; c++) {
                            this.terrain[r][c] = parseInt(chars[c]) || 0;
                        }
                    }
                }
                this.render();
                modal?.classList.add('hidden');
            } else {
                alert(`无效的地图数据！需要 ${GRID_ROWS} 行，当前为 ${lines.length} 行。`);
            }
        });
    }

    private render() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid lines
        this.ctx.strokeStyle = '#222';
        this.ctx.lineWidth = 1;
        for (let r = 0; r <= GRID_ROWS; r++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, r * CELL_SIZE);
            this.ctx.lineTo(this.canvas.width, r * CELL_SIZE);
            this.ctx.stroke();
        }
        for (let c = 0; c <= GRID_COLS; c++) {
            this.ctx.beginPath();
            this.ctx.moveTo(c * CELL_SIZE, 0);
            this.ctx.lineTo(c * CELL_SIZE, this.canvas.height);
            this.ctx.stroke();
        }

        // Draw terrain
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const type = this.terrain[r][c];
                if (type === 0) continue;

                const x = c * CELL_SIZE;
                const y = r * CELL_SIZE;

                switch (type) {
                    case 1: // Brick
                        this.ctx.fillStyle = '#b64';
                        this.ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                        break;
                    case 2: // Steel
                        this.ctx.fillStyle = '#aaa';
                        this.ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                        break;
                    case 3: // Forest
                        this.ctx.fillStyle = '#1e661e';
                        this.ctx.globalAlpha = 0.7;
                        this.ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
                        this.ctx.globalAlpha = 1.0;
                        break;
                    case 4: // Water
                        this.ctx.fillStyle = '#083855';
                        this.ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
                        break;
                    case 5: // Ice
                        this.ctx.fillStyle = '#bdf';
                        this.ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
                        break;
                    case 6: // Base
                        this.ctx.fillStyle = '#f94';
                        this.ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                        break;
                }
            }
        }
    }
}

// Start the editor
new MapEditor();
