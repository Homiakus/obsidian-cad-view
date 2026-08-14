import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as fs from "fs";

import { CadBridge } from "./cad/bridge";
import { CacheManager } from "./cad/cache-manager";
import { PreviewManager } from "./cad/preview-manager";
import { CadEmbedComponent, CadViewLeaf, VIEW_TYPE_CAD } from "./cad/cad-view";
import { DiagnosticsModal } from "./cad/diagnostics-modal";
import { CadSettingTab } from "./settings";
import { DEFAULT_SETTINGS, PluginSettings, PreviewOptions } from "./cad/types";

export default class CadPlugin extends Plugin {
    public settings: PluginSettings = DEFAULT_SETTINGS;
    public bridge!: CadBridge;
    public cacheManager!: CacheManager;
    public previewManager!: PreviewManager;

    private activeEmbeds: Set<CadEmbedComponent> = new Set();

    async onload() {
        console.log("Loading Obsidian CAD Preview plugin (Siemens NX PRT / STEP / JT)...");

        // 1. Load Settings
        await this.loadSettings();

        // 2. Initialize Subsystems
        const basePath = (this.app.vault.adapter as any).basePath || process.cwd();
        const pluginDir = path.join(basePath, ".obsidian", "plugins", "obsidian-cad-preview");

        this.bridge = new CadBridge(this.settings.bridgeExecutablePath, pluginDir);
        this.cacheManager = new CacheManager(this.app, pluginDir);
        this.previewManager = new PreviewManager(this.bridge, this.cacheManager, this.settings);

        // 3. Register Settings Tab
        this.addSettingTab(new CadSettingTab(this.app, this));

        // 4. Register Workspace View Leaf for Dedicated Tabs
        this.registerView(
            VIEW_TYPE_CAD,
            (leaf: WorkspaceLeaf) => new CadViewLeaf(leaf, this.previewManager)
        );

        // 5. Register CAD File Extensions
        const supportedExtensions = ["prt", "step", "stp", "jt"];
        try {
            this.registerExtensions(supportedExtensions, VIEW_TYPE_CAD);
        } catch (e) {
            console.warn("Extensions registration note:", e);
        }

        // 6. Register Markdown Post-Processor for embeds: ![[model.prt]]
        this.registerMarkdownPostProcessor((el, ctx) => {
            this.processMarkdownEmbeds(el, ctx);
        });

        // 7. Register Codeblock Processor for ```cad ... ```
        this.registerMarkdownCodeBlockProcessor("cad", (source, el, ctx) => {
            this.processCadCodeBlock(source, el, ctx);
        });

        // 8. Register Commands
        this.addCommand({
            id: "cad-insert-block",
            name: "Вставить блок предпросмотра CAD-модели",
            editorCallback: (editor: Editor, view: MarkdownView) => {
                const snippet = "```cad\nfile: \n```\n";
                editor.replaceSelection(snippet);
                new Notice("Блок CAD-предпросмотра вставлен. Нажмите «Выбрать модель» в блоке.");
            }
        });

        this.addCommand({
            id: "cad-pick-and-insert",
            name: "Выбрать CAD-модель через Проводник и вставить блок",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                const chosenPath = await openCadFileDialog(this.app);
                if (!chosenPath) return;

                const snippet = `\`\`\`cad\nfile: ${chosenPath}\n\`\`\`\n`;
                editor.replaceSelection(snippet);
                new Notice(`CAD-модель добавлена: ${chosenPath.split(/[/\\]/).pop()}`);
            }
        });

        this.addCommand({
            id: "cad-diagnostics",
            name: "Диагностика системы (Siemens NX / Bridge / Cache)",
            callback: () => {
                new DiagnosticsModal(this.app, this.bridge, this.cacheManager, this.previewManager, this.settings).open();
            }
        });

        this.addCommand({
            id: "cad-clear-cache",
            name: "Очистить кэш 3D-моделей",
            callback: async () => {
                await this.cacheManager.clearCache();
                new Notice("Кэш CAD-моделей полностью очищен.");
            }
        });

        // 9. Register Ribbon Icon
        this.addRibbonIcon("box", "CAD Preview: Диагностика", () => {
            new DiagnosticsModal(this.app, this.bridge, this.cacheManager, this.previewManager, this.settings).open();
        });

        // 10. Vault Watcher for Auto Update
        if (this.settings.autoUpdate) {
            this.registerEvent(
                this.app.vault.on("modify", (file) => {
                    if (file instanceof TFile && supportedExtensions.includes(file.extension.toLowerCase())) {
                        const basePath = (this.app.vault.adapter as any).basePath || "";
                        const fullPath = path.join(basePath, file.path);
                        this.cacheManager.notifyFileChanged(fullPath, this.settings.autoUpdateDebounceMs);
                    }
                })
            );

            this.cacheManager.setInvalidationListener((filePath) => {
                console.log(`[CAD_PREVIEW] File updated externally: ${filePath}. Refreshing views...`);
                // Trigger reload on matching embeds
                this.activeEmbeds.forEach(embed => {
                    embed.regenerate();
                });
            });
        }
    }

    onunload() {
        console.log("Unloading Obsidian CAD Preview plugin.");
        this.activeEmbeds.forEach(embed => embed.dispose());
        this.activeEmbeds.clear();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.previewManager?.updateSettings(this.settings);
    }

    /**
     * Finds and replaces standard Obsidian attachment links for PRT, STEP, JT files
     */
    private processMarkdownEmbeds(element: HTMLElement, context: any) {
        // Find internal embed elements: .internal-embed, span.internal-embed, etc.
        const embedEls = element.querySelectorAll(".internal-embed, .file-embed");

        embedEls.forEach((embedEl) => {
            const src = embedEl.getAttribute("src");
            if (!src) return;

            const alt = embedEl.getAttribute("alt") || "";
            const parsed = this.parseEmbedSource(src, alt);
            if (!parsed.isCad) return;

            // Resolve file in vault
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(parsed.filePath, context.sourcePath || "");
            const basePath = (this.app.vault.adapter as any).basePath || process.cwd();

            let absoluteCadPath = "";
            if (targetFile) {
                absoluteCadPath = path.join(basePath, targetFile.path);
            } else {
                // If direct relative/absolute path
                absoluteCadPath = path.isAbsolute(parsed.filePath) ? parsed.filePath : path.join(basePath, parsed.filePath);
            }

            // Replace embed content with our interactive 3D viewer
            embedEl.empty();
            const embedWrapper = document.createElement("div");
            embedEl.appendChild(embedWrapper);

            const options: PreviewOptions = {
                quality: this.settings.previewQuality,
                projection: this.settings.defaultProjection,
                defaultView: this.settings.defaultView,
                showEdges: this.settings.showEdges,
                ...parsed.options
            };

            const cadComponent = new CadEmbedComponent(
                this.app,
                embedWrapper,
                absoluteCadPath,
                this.previewManager,
                options,
                parsed.alias
            );

            this.activeEmbeds.add(cadComponent);
        });
    }

    /**
     * Handles ```cad code blocks with parameters
     */
    private processCadCodeBlock(source: string, element: HTMLElement, context: any) {
        const lines = source.split("\n");
        let filePath = "";
        let alias = "";
        const options: PreviewOptions = {};

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;

            const colonIdx = trimmed.indexOf(":");
            if (colonIdx === -1) {
                if (!filePath) filePath = trimmed;
                continue;
            }

            const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
            const val = trimmed.slice(colonIdx + 1).trim();

            if (key === "file" || key === "path" || key === "source") {
                filePath = val;
            } else if (key === "alias" || key === "title" || key === "name") {
                alias = val;
            } else if (key === "width") {
                options.width = val;
            } else if (key === "height" && !isNaN(parseInt(val, 10))) {
                options.height = parseInt(val, 10);
            } else if (key === "quality") {
                options.quality = val as any;
            } else if (key === "view") {
                options.defaultView = val as any;
            } else if (key === "projection" || key === "camera") {
                options.projection = val as any;
            }
        }

        if (!filePath) {
            this.renderEmptyCadBlock(element, context, options, alias);
            return;
        }

        const targetFile = this.app.metadataCache.getFirstLinkpathDest(filePath, context.sourcePath || "");
        const basePath = (this.app.vault.adapter as any).basePath || process.cwd();
        const absoluteCadPath = targetFile ? path.join(basePath, targetFile.path) : path.isAbsolute(filePath) ? filePath : path.join(basePath, filePath);

        element.empty();
        const embedWrapper = document.createElement("div");
        element.appendChild(embedWrapper);

        const mergedOptions: PreviewOptions = {
            quality: this.settings.previewQuality,
            projection: this.settings.defaultProjection,
            defaultView: this.settings.defaultView,
            showEdges: this.settings.showEdges,
            ...options
        };

        const cadComponent = new CadEmbedComponent(
            this.app,
            embedWrapper,
            absoluteCadPath,
            this.previewManager,
            mergedOptions,
            alias
        );

        this.activeEmbeds.add(cadComponent);
    }

    /**
     * Renders a placeholder block with a "Select Model" button when no file is specified
     */
    private renderEmptyCadBlock(element: HTMLElement, context: any, options: PreviewOptions, alias?: string) {
        element.empty();

        const container = document.createElement("div");
        container.className = "obsidian-cad-container cad-empty-container";
        if (options.height) {
            container.style.height = `${options.height}px`;
        }
        if (options.width) {
            container.style.width = options.width.endsWith("%") || options.width.endsWith("px") || options.width.endsWith("rem") ? options.width : `${options.width}px`;
        }

        container.innerHTML = `
            <div class="cad-header">
                <div class="cad-title-group">
                    <span class="cad-file-badge">CAD</span>
                    <span class="cad-title">${alias || "Предпросмотр 3D-модели"}</span>
                </div>
            </div>
            <div class="cad-empty-body">
                <div class="cad-empty-icon-wrap">
                    <svg class="cad-empty-svg" viewBox="0 0 24 24" width="38" height="38" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                </div>
                <div class="cad-empty-title">Выберите CAD-модель</div>
                <div class="cad-empty-desc">Форматы: Siemens NX (<strong>.prt</strong>), STEP (<strong>.step, .stp</strong>), JT (<strong>.jt</strong>)</div>
                <button class="cad-btn-primary cad-btn-select-model">
                    <span style="font-size:14px;margin-right:6px;">📁</span> Выбрать модель в Проводнике
                </button>
                <div class="cad-empty-hint">Или укажите путь в блоке: <code>file: models/part.prt</code></div>
            </div>
        `;

        const selectBtn = container.querySelector(".cad-btn-select-model");
        selectBtn?.addEventListener("click", async () => {
            const chosenPath = await openCadFileDialog(this.app);
            if (!chosenPath) return;

            new Notice(`Выбрана модель: ${chosenPath.split(/[/\\]/).pop()}`);

            // Update the markdown note source code
            await this.updateCodeBlockInFile(context, element, chosenPath);

            // Immediately render the CAD component in place
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(chosenPath, context.sourcePath || "");
            const basePath = (this.app.vault.adapter as any).basePath || process.cwd();
            const absoluteCadPath = targetFile ? path.join(basePath, targetFile.path) : path.isAbsolute(chosenPath) ? chosenPath : path.join(basePath, chosenPath);

            element.empty();
            const embedWrapper = document.createElement("div");
            element.appendChild(embedWrapper);

            const mergedOptions: PreviewOptions = {
                quality: this.settings.previewQuality,
                projection: this.settings.defaultProjection,
                defaultView: this.settings.defaultView,
                showEdges: this.settings.showEdges,
                ...options
            };

            const cadComponent = new CadEmbedComponent(
                this.app,
                embedWrapper,
                absoluteCadPath,
                this.previewManager,
                mergedOptions,
                alias
            );

            this.activeEmbeds.add(cadComponent);
        });

        element.appendChild(container);
    }

    /**
     * Updates the markdown codeblock in the source note with the chosen file path
     */
    private async updateCodeBlockInFile(context: any, element: HTMLElement, newPath: string) {
        if (!context || !context.sourcePath) return;

        try {
            const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
            if (!(file instanceof TFile)) return;

            const info = context.getSectionInfo ? context.getSectionInfo(element) : null;
            const fileContent = await this.app.vault.read(file);
            const allLines = fileContent.split("\n");

            if (info && typeof info.lineStart === "number" && typeof info.lineEnd === "number") {
                const blockLines = allLines.slice(info.lineStart, info.lineEnd + 1);
                let fileLineIndex = -1;

                for (let i = 0; i < blockLines.length; i++) {
                    const trimmed = blockLines[i].trim().toLowerCase();
                    if (trimmed.startsWith("file:") || trimmed.startsWith("path:") || trimmed.startsWith("source:")) {
                        fileLineIndex = i;
                        break;
                    }
                }

                if (fileLineIndex !== -1) {
                    const prefix = blockLines[fileLineIndex].split(":")[0];
                    blockLines[fileLineIndex] = `${prefix}: ${newPath}`;
                } else {
                    // Insert after opening ```cad line
                    blockLines.splice(1, 0, `file: ${newPath}`);
                }

                allLines.splice(info.lineStart, info.lineEnd - info.lineStart + 1, ...blockLines);
                await this.app.vault.modify(file, allLines.join("\n"));
            } else {
                // Fallback replace in note
                const updated = fileContent.replace(/(```cad\s*[\r\n]+)([\s\S]*?)(```)/, (match, p1, p2, p3) => {
                    if (!p2.includes("file:") && !p2.includes("path:") && !p2.includes("source:")) {
                        return `${p1}file: ${newPath}\n${p2}${p3}`;
                    } else {
                        return `${p1}${p2.replace(/(file|path|source):\s*[^\r\n]*/i, `$1: ${newPath}`)}${p3}`;
                    }
                });
                if (updated !== fileContent) {
                    await this.app.vault.modify(file, updated);
                }
            }
        } catch (e) {
            console.warn("Failed to update markdown file with chosen CAD model:", e);
        }
    }

    private parseEmbedSource(rawSrc: string, altText: string = ""): { isCad: boolean; filePath: string; alias?: string; options: PreviewOptions } {
        const supported = [".prt", ".step", ".stp", ".jt"];

        // Combine src parts and alt text
        const parts = rawSrc.split("|");
        const filePath = parts[0].trim();
        const ext = path.extname(filePath).toLowerCase();

        if (!supported.includes(ext)) {
            return { isCad: false, filePath, options: {} };
        }

        let alias: string | undefined;
        const options: PreviewOptions = {};

        const parseParam = (param: string) => {
            if (!param) return;
            const p = param.trim();

            // Match dimensions: "300x200", "300*200"
            const dimMatch = p.match(/^(\d{2,4})\s*[x*×]\s*(\d{2,4})$/i);
            if (dimMatch) {
                options.width = `${dimMatch[1]}px`;
                options.height = parseInt(dimMatch[2], 10);
                return;
            }

            // Match single width: "300", "350px", "50%"
            const singleNum = p.match(/^(\d{2,4})(px)?$/i);
            if (singleNum) {
                const w = parseInt(singleNum[1], 10);
                options.width = `${w}px`;
                options.height = Math.round(w * 0.7); // 4:3 aspect
                return;
            }

            // Match keywords: "thumbnail", "mini"
            if (p.toLowerCase() === "thumbnail" || p.toLowerCase() === "mini" || p.toLowerCase() === "миниатюра") {
                options.width = "280px";
                options.height = 200;
                return;
            }

            // Match key=value
            if (p.includes("=")) {
                const [key, val] = p.split("=").map(s => s.trim());
                if (key.toLowerCase() === "height" && !isNaN(parseInt(val, 10))) {
                    options.height = parseInt(val, 10);
                } else if (key.toLowerCase() === "width") {
                    options.width = val;
                } else if (key.toLowerCase() === "quality") {
                    options.quality = val as any;
                } else if (key.toLowerCase() === "camera" || key.toLowerCase() === "projection") {
                    options.projection = val as any;
                }
            } else if (!alias && isNaN(Number(p))) {
                alias = p;
            }
        };

        for (let i = 1; i < parts.length; i++) {
            parseParam(parts[i]);
        }
        if (altText) {
            parseParam(altText);
        }

        return { isCad: true, filePath, alias, options };
    }
}

/**
 * Opens system native file dialog to select a CAD file (.prt, .step, .stp, .jt)
 */
export function openCadFileDialog(app: App): Promise<string | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".prt,.step,.stp,.jt,.PRT,.STEP,.STP,.JT";
        input.style.display = "none";
        document.body.appendChild(input);

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                cleanup();
                return;
            }

            const rawPath: string = (file as any).path || file.name;
            const basePath = (app.vault.adapter as any).basePath || "";

            let normalized = rawPath.replace(/\\/g, "/");
            const normBase = basePath ? basePath.replace(/\\/g, "/") : "";

            if (normBase && normalized.toLowerCase().startsWith(normBase.toLowerCase() + "/")) {
                normalized = normalized.slice(normBase.length + 1);
            }

            resolve(normalized);
            cleanup();
        };

        input.oncancel = () => {
            resolve(null);
            cleanup();
        };

        const cleanup = () => {
            if (input.parentNode) {
                input.parentNode.removeChild(input);
            }
        };

        input.click();
    });
}

