import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CadPlugin from "./main";
import { CameraProjection, QualityLevel, StandardView } from "./cad/types";

export class CadSettingTab extends PluginSettingTab {
    private plugin: CadPlugin;

    constructor(app: App, plugin: CadPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Настройки CAD Preview (Siemens NX / STEP / JT)" });

        // --- SIEMENS NX PATH ---
        new Setting(containerEl)
            .setName("Каталог Siemens NX")
            .setDesc("Путь к установленной версии Siemens NX (например, C:\\Program Files\\Siemens\\NX2512)")
            .addText((text) =>
                text
                    .setPlaceholder("Автоопределение...")
                    .setValue(this.plugin.settings.nxPath)
                    .onChange(async (value) => {
                        this.plugin.settings.nxPath = value.trim();
                        await this.plugin.saveSettings();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Автодетекция")
                    .setTooltip("Попытаться обнаружить Siemens NX автоматически")
                    .onClick(async () => {
                        button.setDisabled(true);
                        const info = await this.plugin.bridge.testNx();
                        button.setDisabled(false);
                        if (info.isFound && info.baseDir) {
                            this.plugin.settings.nxPath = info.baseDir;
                            await this.plugin.saveSettings();
                            this.display();
                            new Notice(`✓ Обнаружен ${info.version}: ${info.baseDir}`);
                        } else {
                            new Notice("Siemens NX не найден в стандартных путях.");
                        }
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Проверить NX")
                    .setCta()
                    .onClick(async () => {
                        button.setDisabled(true);
                        const info = await this.plugin.bridge.testNx(this.plugin.settings.nxPath);
                        button.setDisabled(false);
                        if (info.isFound) {
                            new Notice(`✓ Siemens NX доступен (${info.version})\nBatch: ${info.batchExecutionAvailable ? "Да" : "Нет"}`);
                        } else {
                            new Notice("✗ Не удалось подключиться к Siemens NX.");
                        }
                    })
            );

        // --- PREVIEW QUALITY ---
        new Setting(containerEl)
            .setName("Качество тесселяции")
            .setDesc("Точность преобразования B-Rep в треугольную сетку GLB")
            .addDropdown((drop) =>
                drop
                    .addOption("draft", "Draft (Быстро / Черновое)")
                    .addOption("normal", "Normal (Стандартное инженерное)")
                    .addOption("high", "High (Высокая детализация)")
                    .addOption("ultra", "Ultra (Максимальная точность)")
                    .setValue(this.plugin.settings.previewQuality)
                    .onChange(async (val: string) => {
                        this.plugin.settings.previewQuality = val as QualityLevel;
                        await this.plugin.saveSettings();
                    })
            );

        // --- DEFAULT VIEW ---
        new Setting(containerEl)
            .setName("Стандартный вид камеры")
            .setDesc("Положение камеры при первоначальном открытии 3D модели")
            .addDropdown((drop) =>
                drop
                    .addOption("iso", "Isometric (Изометрия)")
                    .addOption("front", "Front (Спереди)")
                    .addOption("top", "Top (Сверху)")
                    .addOption("right", "Right (Справа)")
                    .setValue(this.plugin.settings.defaultView)
                    .onChange(async (val: string) => {
                        this.plugin.settings.defaultView = val as StandardView;
                        await this.plugin.saveSettings();
                    })
            );

        // --- DEFAULT PROJECTION ---
        new Setting(containerEl)
            .setName("Проекция камеры")
            .setDesc("Ортогональная проекция рекомендуется для инженерных CAD-чертежей")
            .addDropdown((drop) =>
                drop
                    .addOption("orthographic", "Ортогональная (Orthographic)")
                    .addOption("perspective", "Перспективная (Perspective)")
                    .setValue(this.plugin.settings.defaultProjection)
                    .onChange(async (val: string) => {
                        this.plugin.settings.defaultProjection = val as CameraProjection;
                        await this.plugin.saveSettings();
                    })
            );

        // --- SHOW EDGES ---
        new Setting(containerEl)
            .setName("Отображать рёбра граней (Shaded with Edges)")
            .setDesc("Подчёркивать острые кромки и контуры деталей")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showEdges)
                    .onChange(async (val) => {
                        this.plugin.settings.showEdges = val;
                        await this.plugin.saveSettings();
                    })
            );

        // --- AUTO UPDATE ---
        new Setting(containerEl)
            .setName("Автоматическое обновление при изменении CAD-файла")
            .setDesc("Отслеживать сохранение файлов в Siemens NX и обновлять предпросмотр")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoUpdate)
                    .onChange(async (val) => {
                        this.plugin.settings.autoUpdate = val;
                        await this.plugin.saveSettings();
                    })
            );

        // --- CACHE SECTION ---
        const cacheSetting = new Setting(containerEl)
            .setName("Кэш 3D предпросмотров")
            .setDesc("Загрузка данных о размере кэша...");

        this.plugin.cacheManager.getCacheSize().then((stats) => {
            cacheSetting.setDesc(`Общий объём кэша: ${stats.formatted}`);
        });

        cacheSetting.addButton((button) =>
            button
                .setButtonText("Очистить кэш")
                .setWarning()
                .onClick(async () => {
                    await this.plugin.cacheManager.clearCache();
                    const stats = await this.plugin.cacheManager.getCacheSize();
                    cacheSetting.setDesc(`Общий объём кэша: ${stats.formatted}`);
                    new Notice("Кэш CAD-моделей полностью очищен.");
                })
        );

        // --- ADVANCED SECTION ---
        containerEl.createEl("h3", { text: "Дополнительные параметры (Advanced)" });

        new Setting(containerEl)
            .setName("Таймаут конвертации (сек)")
            .setDesc("Максимальное время ожидания ответа Siemens NX до прерывания процесса")
            .addSlider((slider) =>
                slider
                    .setLimits(15, 600, 15)
                    .setValue(this.plugin.settings.conversionTimeoutSeconds)
                    .setDynamicTooltip()
                    .onChange(async (val) => {
                        this.plugin.settings.conversionTimeoutSeconds = val;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Максимум параллельных воркеров NX")
            .setDesc("Рекомендуется 1 воркер для предотвращения перегрузки лицензий и CPU")
            .addDropdown((drop) =>
                drop
                    .addOption("1", "1 воркер (Последовательно)")
                    .addOption("2", "2 воркера")
                    .setValue(this.plugin.settings.maxConcurrentConversions.toString())
                    .onChange(async (val) => {
                        this.plugin.settings.maxConcurrentConversions = parseInt(val, 10);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Порог предупреждения о больших моделях (треугольники)")
            .setDesc("Предупреждать перед рендерингом моделей с чрезмерным количеством полигонов")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.triangleWarningThreshold.toString())
                    .onChange(async (val) => {
                        const num = parseInt(val, 10);
                        if (!isNaN(num)) {
                            this.plugin.settings.triangleWarningThreshold = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );
    }
}
