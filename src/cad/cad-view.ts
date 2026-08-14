import { App, FileView, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { CadRenderer } from "./renderer";
import { ModelTreePanel } from "./model-tree";
import { PreviewManager } from "./preview-manager";
import { CameraProjection, DisplayMode, PreviewOptions, PreviewResult, PreviewState, StandardView } from "./types";

export const VIEW_TYPE_CAD = "obsidian-cad-view";

export class CadEmbedComponent {
    private app: App;
    private container: HTMLElement;
    private sourcePath: string;
    private aliasName?: string;
    private options: PreviewOptions;
    private previewManager: PreviewManager;

    private renderer: CadRenderer | null = null;
    private modelTree: ModelTreePanel | null = null;
    private currentResult: PreviewResult | null = null;

    private viewportEl!: HTMLElement;
    private headerEl!: HTMLElement;
    private footerEl!: HTMLElement;
    private loadingOverlay!: HTMLElement;
    private errorOverlay!: HTMLElement;
    private sectionOverlay!: HTMLElement;

    private intersectionObserver?: IntersectionObserver;
    private isLoaded: boolean = false;

    constructor(
        app: App,
        container: HTMLElement,
        sourcePath: string,
        previewManager: PreviewManager,
        options: PreviewOptions = {},
        aliasName?: string
    ) {
        this.app = app;
        this.container = container;
        this.sourcePath = sourcePath;
        this.aliasName = aliasName;
        this.options = options;
        this.previewManager = previewManager;

        this.buildUI();
        this.initLazyLoad();
    }

    private buildUI() {
        this.container.classList.add("obsidian-cad-container");

        const h = this.options.height;
        const w = this.options.width;

        if (h) {
            this.container.style.height = `${h}px`;
            if (h <= 340) {
                this.container.classList.add("is-compact");
            }
        }
        if (w) {
            this.container.style.width = w.endsWith("%") || w.endsWith("px") || w.endsWith("rem") ? w : `${w}px`;
            this.container.style.maxWidth = "100%";
        }

        const fileName = this.aliasName || this.sourcePath.split(/[/\\]/).pop() || "Model";
        const ext = (this.sourcePath.split(".").pop() || "CAD").toUpperCase();

        // 1. Header Toolbar
        this.headerEl = document.createElement("div");
        this.headerEl.className = "cad-header";
        this.headerEl.innerHTML = `
            <div class="cad-title-group">
                <span class="cad-file-badge">${ext}</span>
                <span class="cad-title" title="${this.sourcePath}">${fileName}</span>
            </div>
            <div class="cad-header-actions">
                <button class="cad-btn cad-btn-regen" title="Перегенерировать предпросмотр">⟳</button>
                <button class="cad-btn cad-btn-open-nx" title="Открыть исходный файл в Siemens NX">↗ NX</button>
                <button class="cad-btn cad-btn-fullscreen" title="Полноэкранный режим">⛶</button>
            </div>
        `;
        this.container.appendChild(this.headerEl);

        // 2. Viewport
        this.viewportEl = document.createElement("div");
        this.viewportEl.className = "cad-viewport";
        this.container.appendChild(this.viewportEl);

        // 3. Loading Overlay
        this.loadingOverlay = document.createElement("div");
        this.loadingOverlay.className = "cad-loading-overlay";
        this.loadingOverlay.innerHTML = `
            <div class="cad-spinner"></div>
            <div class="cad-loading-status">Подготовка Siemens NX...</div>
            <div class="cad-loading-subtext">${fileName}</div>
            <div class="cad-progress-bar-container">
                <div class="cad-progress-bar-fill"></div>
            </div>
        `;
        this.viewportEl.appendChild(this.loadingOverlay);

        // 4. Error Overlay
        this.errorOverlay = document.createElement("div");
        this.errorOverlay.className = "cad-error-overlay";
        this.errorOverlay.style.display = "none";
        this.errorOverlay.innerHTML = `
            <div class="cad-error-icon">⚠️</div>
            <div class="cad-error-title">Не удалось создать предпросмотр</div>
            <div class="cad-error-msg"></div>
            <div class="cad-error-buttons">
                <button class="cad-btn-view cad-btn-retry">Повторить</button>
                <button class="cad-btn-view cad-btn-pick-file">📁 Выбрать другой файл</button>
                <button class="cad-btn-view cad-btn-err-nx">Открыть в NX</button>
            </div>
        `;
        this.viewportEl.appendChild(this.errorOverlay);

        // 5. Sectioning Tool Overlay
        this.sectionOverlay = document.createElement("div");
        this.sectionOverlay.className = "cad-tool-overlay";
        this.sectionOverlay.style.display = "none";
        this.sectionOverlay.innerHTML = `
            <span style="font-size:11px;font-weight:600;color:var(--text-muted);">Сечение:</span>
            <div class="cad-section-axis-group" style="display:flex;gap:4px;">
                <button class="cad-btn-view is-active" data-axis="X">X</button>
                <button class="cad-btn-view" data-axis="Y">Y</button>
                <button class="cad-btn-view" data-axis="Z">Z</button>
            </div>
            <input type="range" class="cad-slider" min="0" max="100" value="50" style="width:120px;">
            <button class="cad-btn-view cad-btn-inv" title="Инвертировать направление плоскости">⇄ Инверт</button>
            <button class="cad-btn cad-btn-close-sec" style="font-size:10px;">✕</button>
        `;
        this.viewportEl.appendChild(this.sectionOverlay);

        // 6. Footer Toolbar
        this.footerEl = document.createElement("div");
        this.footerEl.className = "cad-footer";
        this.footerEl.innerHTML = `
            <div class="cad-footer-group">
                <button class="cad-btn-view" data-view="iso">ISO</button>
                <button class="cad-btn-view" data-view="front">FRONT</button>
                <button class="cad-btn-view" data-view="top">TOP</button>
                <button class="cad-btn-view" data-view="right">RIGHT</button>
                <div class="cad-divider"></div>
                <button class="cad-btn-view cad-btn-fit" title="Центрировать и подогнать масштаб">Fit</button>
            </div>
            <div class="cad-footer-group">
                <button class="cad-btn cad-btn-edges is-active" title="Режим отображения (Затенение / Рёбра / Каркас)">🔲</button>
                <button class="cad-btn cad-btn-proj" title="Проекция (Ортогональная / Перспективная)">📐</button>
                <div class="cad-divider"></div>
                <button class="cad-btn cad-btn-section" title="Плоскость сечения">✂️</button>
                <button class="cad-btn cad-btn-measure" title="Измерение расстояний">📏</button>
                <div class="cad-divider"></div>
                <button class="cad-btn cad-btn-tree" title="Дерево сборки">📦</button>
                <button class="cad-btn cad-btn-props" title="Свойства">ℹ️</button>
            </div>
        `;
        this.container.appendChild(this.footerEl);

        this.bindEvents();
    }

    private bindEvents() {
        // Header buttons
        this.headerEl.querySelector(".cad-btn-regen")?.addEventListener("click", () => {
            this.regenerate();
        });
        this.headerEl.querySelector(".cad-btn-open-nx")?.addEventListener("click", () => {
            this.openInNx();
        });
        this.headerEl.querySelector(".cad-btn-fullscreen")?.addEventListener("click", () => {
            this.toggleFullscreen();
        });

        // Error overlay buttons
        this.errorOverlay.querySelector(".cad-btn-retry")?.addEventListener("click", () => {
            this.loadModel();
        });
        this.errorOverlay.querySelector(".cad-btn-pick-file")?.addEventListener("click", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".prt,.step,.stp,.jt,.PRT,.STEP,.STP,.JT";
            input.style.display = "none";
            document.body.appendChild(input);

            input.onchange = async () => {
                const file = input.files?.[0];
                if (file) {
                    const rawPath: string = (file as any).path || file.name;
                    const basePath = (this.app.vault.adapter as any).basePath || "";
                    let normalized = rawPath.replace(/\\/g, "/");
                    const normBase = basePath ? basePath.replace(/\\/g, "/") : "";
                    if (normBase && normalized.toLowerCase().startsWith(normBase.toLowerCase() + "/")) {
                        normalized = normalized.slice(normBase.length + 1);
                    }
                    const targetFile = this.app.metadataCache.getFirstLinkpathDest(normalized, "");
                    const absPath = targetFile ? path.join(basePath, targetFile.path) : path.isAbsolute(normalized) ? normalized : path.join(basePath, normalized);
                    await this.changeModelFile(absPath);
                }
                if (input.parentNode) input.parentNode.removeChild(input);
            };

            input.oncancel = () => {
                if (input.parentNode) input.parentNode.removeChild(input);
            };

            input.click();
        });
        this.errorOverlay.querySelector(".cad-btn-err-nx")?.addEventListener("click", () => {
            this.openInNx();
        });

        // Footer standard views
        this.footerEl.querySelectorAll("[data-view]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const view = (e.currentTarget as HTMLElement).dataset.view as StandardView;
                if (view && this.renderer) this.renderer.setView(view);
            });
        });

        // Fit
        this.footerEl.querySelector(".cad-btn-fit")?.addEventListener("click", () => {
            if (this.renderer) this.renderer.fit();
        });

        // Display Mode Toggle
        this.footerEl.querySelector(".cad-btn-edges")?.addEventListener("click", () => {
            if (!this.renderer) return;
            const current = this.renderer.getDisplayMode();
            const next: DisplayMode = current === "shadedEdges" ? "shaded" : current === "shaded" ? "wireframe" : "shadedEdges";
            this.renderer.setDisplayMode(next);
            new Notice(`Режим: ${next === "shadedEdges" ? "Shaded + Edges" : next === "shaded" ? "Shaded" : "Wireframe"}`);
        });

        // Projection Toggle
        this.footerEl.querySelector(".cad-btn-proj")?.addEventListener("click", () => {
            if (!this.renderer) return;
            const current = this.renderer.getProjection();
            const next: CameraProjection = current === "orthographic" ? "perspective" : "orthographic";
            this.renderer.setProjection(next);
            new Notice(`Камера: ${next === "orthographic" ? "Ортогональная" : "Перспективная"}`);
        });

        // Sectioning Toggle
        const secBtn = this.footerEl.querySelector(".cad-btn-section");
        secBtn?.addEventListener("click", () => {
            if (!this.renderer) return;
            const isNowEnabled = !this.renderer.section.getIsEnabled();
            this.renderer.section.setEnabled(isNowEnabled);
            this.sectionOverlay.style.display = isNowEnabled ? "flex" : "none";
            secBtn.classList.toggle("is-active", isNowEnabled);
        });

        // Section Overlay controls
        this.sectionOverlay.querySelectorAll("[data-axis]").forEach(b => {
            b.addEventListener("click", (e) => {
                const target = e.currentTarget as HTMLElement;
                const axis = target.dataset.axis as "X" | "Y" | "Z";
                this.sectionOverlay.querySelectorAll("[data-axis]").forEach(x => x.classList.remove("is-active"));
                target.classList.add("is-active");
                if (this.renderer) this.renderer.section.setAxis(axis);
            });
        });

        const slider = this.sectionOverlay.querySelector(".cad-slider") as HTMLInputElement;
        slider?.addEventListener("input", () => {
            const val = parseFloat(slider.value) / 100.0;
            if (this.renderer) this.renderer.section.setPositionNormalized(val);
        });

        this.sectionOverlay.querySelector(".cad-btn-inv")?.addEventListener("click", () => {
            if (!this.renderer) return;
            const inv = !this.renderer.section.getIsInverted();
            this.renderer.section.setInverted(inv);
        });

        this.sectionOverlay.querySelector(".cad-btn-close-sec")?.addEventListener("click", () => {
            if (this.renderer) this.renderer.section.setEnabled(false);
            this.sectionOverlay.style.display = "none";
            secBtn?.classList.remove("is-active");
        });

        // Measurement Toggle
        const measureBtn = this.footerEl.querySelector(".cad-btn-measure");
        measureBtn?.addEventListener("click", () => {
            if (!this.renderer) return;
            const isNowEnabled = !this.renderer.measurement.getIsEnabled();
            this.renderer.measurement.setEnabled(isNowEnabled);
            measureBtn.classList.toggle("is-active", isNowEnabled);
            if (isNowEnabled) {
                new Notice("Режим измерения: кликните 2 точки на модели для расчёта расстояния");
            }
        });

        // Tree Toggle
        this.footerEl.querySelector(".cad-btn-tree")?.addEventListener("click", () => {
            if (this.modelTree) this.modelTree.toggleTree();
        });

        // Props Toggle
        this.footerEl.querySelector(".cad-btn-props")?.addEventListener("click", () => {
            if (this.modelTree) this.modelTree.toggleProps();
        });
    }

    private initLazyLoad() {
        const startLoad = () => {
            if (!this.isLoaded) {
                this.isLoaded = true;
                this.loadModel();
                this.intersectionObserver?.disconnect();
            }
        };

        if (typeof IntersectionObserver !== "undefined") {
            this.intersectionObserver = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) {
                    startLoad();
                }
            }, { rootMargin: "300px" });

            this.intersectionObserver.observe(this.container);
        }

        // Automatic fallback: ensure model loads even if container is initially off-screen or inside custom tab
        setTimeout(() => {
            startLoad();
        }, 100);
    }

    public async loadModel() {
        this.errorOverlay.style.display = "none";
        this.loadingOverlay.style.display = "flex";

        try {
            const result = await this.previewManager.getPreview(
                this.sourcePath,
                this.options,
                (state: PreviewState, statusText: string) => {
                    this.updateProgress(state, statusText);
                }
            );

            this.currentResult = result;
            await this.initRendererAndLoadGlb(result);
            this.loadingOverlay.style.display = "none";
        } catch (err: any) {
            this.showError(err.message || "Ошибка загрузки CAD модели");
        }
    }

    public async regenerate() {
        this.errorOverlay.style.display = "none";
        this.loadingOverlay.style.display = "flex";

        try {
            const result = await this.previewManager.forceRegenerate(
                this.sourcePath,
                this.options,
                (state, text) => this.updateProgress(state, text)
            );

            this.currentResult = result;
            await this.initRendererAndLoadGlb(result);
            this.loadingOverlay.style.display = "none";
            new Notice("CAD-предпросмотр успешно перегенерирован.");
        } catch (err: any) {
            this.showError(err.message || "Ошибка перегенерации");
        }
    }

    private async initRendererAndLoadGlb(result: PreviewResult) {
        if (!this.renderer) {
            this.renderer = new CadRenderer(this.container, this.viewportEl);
            this.modelTree = new ModelTreePanel(this.viewportEl, this.renderer.selection);
        }

        const buffer = fs.readFileSync(result.glbPath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        await this.renderer.loadGlb(arrayBuffer);

        if (result.metadata) {
            this.renderer.measurement.setUnits(result.metadata.units || "mm");
            this.modelTree?.setModelData(result.metadata.assemblyTree || null, result.metadata);
        }
    }

    private updateProgress(state: PreviewState, text: string) {
        const statusEl = this.loadingOverlay.querySelector(".cad-loading-status");
        if (statusEl) statusEl.textContent = text;
    }

    private showError(msg: string) {
        this.loadingOverlay.style.display = "none";
        this.errorOverlay.style.display = "flex";
        const msgEl = this.errorOverlay.querySelector(".cad-error-msg");
        if (msgEl) msgEl.textContent = msg;
    }

    public openInNx() {
        if (!fs.existsSync(this.sourcePath)) {
            new Notice(`Файл не найден: ${this.sourcePath}`);
            return;
        }

        // Launch in OS default application (Siemens NX)
        exec(`start "" "${this.sourcePath}"`, (err) => {
            if (err) {
                new Notice(`Не удалось открыть в Siemens NX: ${err.message}`);
            } else {
                new Notice(`Открытие ${this.sourcePath.split(/[/\\]/).pop()} в Siemens NX...`);
            }
        });
    }

    public async changeModelFile(newPath: string) {
        this.sourcePath = newPath;
        this.aliasName = newPath.split(/[/\\]/).pop();
        const ext = (this.sourcePath.split(".").pop() || "CAD").toUpperCase();
        const titleEl = this.headerEl.querySelector(".cad-title");
        const badgeEl = this.headerEl.querySelector(".cad-file-badge");
        if (titleEl) {
            titleEl.textContent = this.aliasName || "Model";
            titleEl.setAttribute("title", this.sourcePath);
        }
        if (badgeEl) {
            badgeEl.textContent = ext;
        }
        await this.loadModel();
    }

    public toggleFullscreen() {
        const isFull = this.container.classList.toggle("is-fullscreen");
        if (this.renderer) {
            setTimeout(() => this.renderer?.handleResize(), 50);
        }
    }

    public dispose() {
        this.intersectionObserver?.disconnect();
        this.renderer?.dispose();
        this.modelTree?.dispose();
    }
}

export class CadViewLeaf extends FileView {
    private embedComponent: CadEmbedComponent | null = null;
    private previewManager: PreviewManager;

    constructor(leaf: WorkspaceLeaf, previewManager: PreviewManager) {
        super(leaf);
        this.previewManager = previewManager;
    }

    getViewType(): string {
        return VIEW_TYPE_CAD;
    }

    getDisplayText(): string {
        return this.file ? this.file.basename : "CAD Preview";
    }

    getIcon(): string {
        return "box";
    }

    async onLoadFile(file: TFile) {
        this.contentEl.empty();
        this.contentEl.style.height = "100%";
        this.contentEl.style.padding = "0";

        const basePath = (this.app.vault.adapter as any).basePath || "";
        const absolutePath = path.join(basePath, file.path);

        this.embedComponent = new CadEmbedComponent(
            this.app,
            this.contentEl,
            absolutePath,
            this.previewManager,
            { height: undefined, width: "100%" },
            file.basename
        );

        // Immediately trigger load
        this.embedComponent.loadModel();
    }

    async onClose() {
        this.embedComponent?.dispose();
    }
}
