import { App, Modal } from "obsidian";
import { CadBridge } from "./bridge";
import { CacheManager } from "./cache-manager";
import { PreviewManager } from "./preview-manager";
import { PluginSettings } from "./types";

export class DiagnosticsModal extends Modal {
    private bridge: CadBridge;
    private cache: CacheManager;
    private previewManager: PreviewManager;
    private settings: PluginSettings;

    constructor(app: App, bridge: CadBridge, cache: CacheManager, previewManager: PreviewManager, settings: PluginSettings) {
        super(app);
        this.bridge = bridge;
        this.cache = cache;
        this.previewManager = previewManager;
        this.settings = settings;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "CAD Preview: Диагностика системы" });

        const loadingEl = contentEl.createEl("p", { text: "Сбор диагностических данных..." });

        const nxInfo = await this.bridge.testNx(this.settings.nxPath);
        const cacheStats = await this.cache.getCacheSize();
        const queueLen = this.previewManager.getQueueLength();

        loadingEl.remove();

        const table = contentEl.createEl("table", { cls: "cad-diagnostics-table" });
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";
        table.style.marginBottom = "20px";

        const addRow = (param: string, value: string, isOk: boolean | null = null) => {
            const tr = table.createEl("tr");
            tr.style.borderBottom = "1px solid var(--background-modifier-border)";

            const td1 = tr.createEl("td", { text: param });
            td1.style.padding = "6px 8px";
            td1.style.fontWeight = "600";
            td1.style.color = "var(--text-muted)";

            const td2 = tr.createEl("td", { text: value });
            td2.style.padding = "6px 8px";
            if (isOk === true) td2.style.color = "var(--text-success, #4ade80)";
            if (isOk === false) td2.style.color = "var(--text-error, #f87171)";
        };

        addRow("Версия плагина", "1.0.0 (Production)");
        addRow("Статус Siemens NX", nxInfo.isFound ? `✓ Обнаружен (${nxInfo.version})` : "✗ Не найден (Используется Fallback CAD Engine)", nxInfo.isFound);
        addRow("Каталог NX", nxInfo.baseDir || "Не задан");
        addRow("Источник обнаружения NX", nxInfo.detectionSource || "—");
        addRow("Batch Journaling (run_journal)", nxInfo.batchExecutionAvailable ? "✓ Доступен" : "—", nxInfo.batchExecutionAvailable);
        addRow("Каталог кэша", this.cache.getCacheBaseDir());
        addRow("Объём кэша", cacheStats.formatted);
        addRow("Заданий в очереди", queueLen.toString());
        addRow("Режим качества", this.settings.previewQuality.toUpperCase());
        addRow("Автообновление файлов", this.settings.autoUpdate ? "Включено" : "Выключено");

        const btnContainer = contentEl.createDiv({ cls: "cad-modal-buttons" });
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.gap = "10px";

        const clearBtn = btnContainer.createEl("button", { text: "Очистить кэш" });
        clearBtn.addEventListener("click", async () => {
            await this.cache.clearCache();
            this.close();
            new DiagnosticsModal(this.app, this.bridge, this.cache, this.previewManager, this.settings).open();
        });

        const closeBtn = btnContainer.createEl("button", { text: "Закрыть", cls: "mod-cta" });
        closeBtn.addEventListener("click", () => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
