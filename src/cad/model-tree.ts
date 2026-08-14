import { CadMetadata, CadNode } from "./types";
import { SelectedComponentInfo, SelectionManager } from "./selection-manager";

export class ModelTreePanel {
    private container: HTMLElement;
    private treePanel: HTMLElement;
    private propsPanel: HTMLElement;
    private selectionManager: SelectionManager;

    private treeRoot: CadNode | null = null;
    private metadata: CadMetadata | null = null;

    private isTreeVisible: boolean = false;
    private isPropsVisible: boolean = false;

    constructor(container: HTMLElement, selectionManager: SelectionManager) {
        this.container = container;
        this.selectionManager = selectionManager;

        // Assembly Tree Side Panel
        this.treePanel = document.createElement("div");
        this.treePanel.className = "cad-side-panel is-hidden";
        this.treePanel.innerHTML = `
            <div class="cad-panel-header">
                <span>Дерево сборки</span>
                <button class="cad-btn cad-btn-close-tree" title="Закрыть">✕</button>
            </div>
            <div class="cad-panel-content cad-tree-content"></div>
        `;
        this.container.appendChild(this.treePanel);

        // Properties Side Panel (Right)
        this.propsPanel = document.createElement("div");
        this.propsPanel.className = "cad-side-panel is-right is-hidden";
        this.propsPanel.innerHTML = `
            <div class="cad-panel-header">
                <span>Свойства модели</span>
                <button class="cad-btn cad-btn-close-props" title="Закрыть">✕</button>
            </div>
            <div class="cad-panel-content cad-props-content"></div>
        `;
        this.container.appendChild(this.propsPanel);

        this.bindEvents();

        this.selectionManager.onSelectionChange = (info) => {
            this.handleSelectionChange(info);
        };
    }

    private bindEvents() {
        this.treePanel.querySelector(".cad-btn-close-tree")?.addEventListener("click", () => {
            this.toggleTree(false);
        });
        this.propsPanel.querySelector(".cad-btn-close-props")?.addEventListener("click", () => {
            this.toggleProps(false);
        });
    }

    public setModelData(tree: CadNode | null, metadata: CadMetadata | null) {
        this.treeRoot = tree;
        this.metadata = metadata;
        this.renderTree();
        this.renderProps(null);
    }

    public toggleTree(visible?: boolean) {
        this.isTreeVisible = visible !== undefined ? visible : !this.isTreeVisible;
        this.treePanel.classList.toggle("is-hidden", !this.isTreeVisible);
    }

    public toggleProps(visible?: boolean) {
        this.isPropsVisible = visible !== undefined ? visible : !this.isPropsVisible;
        this.propsPanel.classList.toggle("is-hidden", !this.isPropsVisible);
    }

    public isTreeOpen(): boolean {
        return this.isTreeVisible;
    }

    public isPropsOpen(): boolean {
        return this.isPropsVisible;
    }

    private renderTree() {
        const content = this.treePanel.querySelector(".cad-tree-content");
        if (!content) return;
        content.innerHTML = "";

        if (!this.treeRoot) {
            content.innerHTML = "<div style='color:var(--text-muted);padding:10px;'>Нет данных о структуре сборки</div>";
            return;
        }

        const buildNodeEl = (node: CadNode, depth: number = 0): HTMLElement => {
            const row = document.createElement("div");
            row.className = "cad-tree-node";
            row.style.paddingLeft = `${depth * 14 + 6}px`;
            row.dataset.id = node.id;
            row.dataset.name = node.name;

            const hasChildren = node.children && node.children.length > 0;
            const toggleIcon = hasChildren ? "▼" : "•";
            const typeIcon = node.type === "assembly" ? "📦" : "⚙️";

            row.innerHTML = `
                <span class="cad-tree-toggle">${toggleIcon}</span>
                <span class="cad-tree-icon">${typeIcon}</span>
                <span class="cad-tree-label" title="${node.name}">${node.name}</span>
                <div class="cad-tree-actions">
                    <button class="cad-btn cad-btn-vis" title="Скрыть/Показать" style="padding:2px 4px;font-size:10px;">👁️</button>
                    <button class="cad-btn cad-btn-iso" title="Изолировать" style="padding:2px 4px;font-size:10px;">🔍</button>
                </div>
            `;

            row.addEventListener("click", (e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".cad-btn-vis")) {
                    e.stopPropagation();
                    this.selectionManager.toggleVisibility(node.id);
                    return;
                }
                if (target.closest(".cad-btn-iso")) {
                    e.stopPropagation();
                    this.selectionManager.selectByNameOrId(node.name);
                    this.selectionManager.isolateSelected();
                    return;
                }

                // Select in 3D
                this.selectionManager.selectByNameOrId(node.name);
                this.highlightTreeNode(node.id);
            });

            const fragment = document.createElement("div");
            fragment.appendChild(row);

            if (hasChildren) {
                const childrenContainer = document.createElement("div");
                childrenContainer.className = "cad-tree-children";
                for (const child of node.children) {
                    childrenContainer.appendChild(buildNodeEl(child, depth + 1));
                }
                fragment.appendChild(childrenContainer);

                row.querySelector(".cad-tree-toggle")?.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const isCollapsed = childrenContainer.style.display === "none";
                    childrenContainer.style.display = isCollapsed ? "block" : "none";
                    (row.querySelector(".cad-tree-toggle") as HTMLElement).textContent = isCollapsed ? "▼" : "▶";
                });
            }

            return fragment;
        };

        content.appendChild(buildNodeEl(this.treeRoot));
    }

    private handleSelectionChange(info: SelectedComponentInfo | null) {
        if (!info) {
            this.clearTreeHighlight();
            this.renderProps(null);
            return;
        }

        this.highlightTreeNode(info.name);
        this.renderProps(info);
    }

    private highlightTreeNode(nameOrId: string) {
        this.clearTreeHighlight();
        const nodeEls = this.treePanel.querySelectorAll(".cad-tree-node");
        for (let i = 0; i < nodeEls.length; i++) {
            const el = nodeEls[i] as HTMLElement;
            if (el.dataset.id === nameOrId || el.dataset.name === nameOrId) {
                el.classList.add("is-selected");
                el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                break;
            }
        }
    }

    private clearTreeHighlight() {
        this.treePanel.querySelectorAll(".cad-tree-node.is-selected").forEach(el => {
            el.classList.remove("is-selected");
        });
    }

    private renderProps(info: SelectedComponentInfo | null) {
        const content = this.propsPanel.querySelector(".cad-props-content");
        if (!content) return;

        if (info) {
            // Selected Component Props
            content.innerHTML = `
                <div style="font-weight:600;margin-bottom:8px;color:var(--interactive-accent);">${info.name}</div>
                <table style="width:100%;border-collapse:collapse;font-size:11px;">
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Тип:</td><td>Тело/Компонент NX</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">ID:</td><td><code>${info.uuid.slice(0, 8)}</code></td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Материал:</td><td>${info.extras?.material || "Сталь / По умолчанию"}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Масса:</td><td>${info.extras?.mass ? `${info.extras.mass} кг` : "—"}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Видимость:</td><td>${info.mesh.visible ? "Видимый" : "Скрытый"}</td></tr>
                </table>
                <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;">
                    <button class="cad-btn-view cad-btn-act-isolate" style="width:100%;">🔍 Изолировать деталь</button>
                    <button class="cad-btn-view cad-btn-act-ghost" style="width:100%;">👻 Режим Ghost</button>
                    <button class="cad-btn-view cad-btn-act-hide" style="width:100%;">👁️ Скрыть деталь</button>
                </div>
            `;

            content.querySelector(".cad-btn-act-isolate")?.addEventListener("click", () => {
                this.selectionManager.isolateSelected();
            });
            content.querySelector(".cad-btn-act-ghost")?.addEventListener("click", () => {
                this.selectionManager.toggleGhostMode();
            });
            content.querySelector(".cad-btn-act-hide")?.addEventListener("click", () => {
                info.mesh.visible = false;
                this.selectionManager.clearSelection();
            });
        } else if (this.metadata) {
            // General Model Metadata Props
            const m = this.metadata;
            const bbox = m.boundingBox;
            const bboxStr = bbox ? `${bbox.size[0]} × ${bbox.size[1]} × ${bbox.size[2]} ${m.units}` : "—";

            content.innerHTML = `
                <div style="font-weight:600;margin-bottom:8px;color:var(--text-normal);">${m.source}</div>
                <table style="width:100%;border-collapse:collapse;font-size:11px;">
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Формат:</td><td><code>.${m.format.toUpperCase()}</code></td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Единицы:</td><td>${m.units}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Габариты:</td><td>${bboxStr}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Компоненты:</td><td>${m.componentCount}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Тела (Bodies):</td><td>${m.bodyCount}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Треугольники:</td><td>${m.triangleCount.toLocaleString()}</td></tr>
                    <tr><td style="color:var(--text-muted);padding:3px 0;">Движок:</td><td>${m.nxVersion || "Siemens NX"}</td></tr>
                </table>
            `;
        } else {
            content.innerHTML = "<div style='color:var(--text-muted);padding:10px;'>Выберите объект для просмотра свойств</div>";
        }
    }

    public dispose() {
        this.treePanel.remove();
        this.propsPanel.remove();
    }
}
