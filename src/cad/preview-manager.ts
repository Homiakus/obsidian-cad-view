import { CadBridge } from "./bridge";
import { CacheManager } from "./cache-manager";
import { PluginSettings, PreviewOptions, PreviewResult, PreviewState } from "./types";

export interface QueueJob {
    id: string;
    sourcePath: string;
    options: PreviewOptions;
    state: PreviewState;
    statusText: string;
    queuePosition: number;
    listeners: Array<(state: PreviewState, statusText: string, result?: PreviewResult, error?: string) => void>;
    resolve: (res: PreviewResult) => void;
    reject: (err: Error) => void;
    cancelled: boolean;
}

export class PreviewManager {
    private bridge: CadBridge;
    private cache: CacheManager;
    private settings: PluginSettings;
    private queue: QueueJob[] = [];
    private runningJobs: Map<string, QueueJob> = new Map();

    constructor(bridge: CadBridge, cache: CacheManager, settings: PluginSettings) {
        this.bridge = bridge;
        this.cache = cache;
        this.settings = settings;
    }

    public updateSettings(settings: PluginSettings) {
        this.settings = settings;
        this.bridge.updateBridgePath(settings.bridgeExecutablePath);
    }

    public getQueueLength(): number {
        return this.queue.length + this.runningJobs.size;
    }

    public async getPreview(
        sourcePath: string,
        options: PreviewOptions = {},
        onProgress?: (state: PreviewState, statusText: string) => void
    ): Promise<PreviewResult> {
        const quality = options.quality || this.settings.previewQuality;

        // 1. Check Cache directly alongside source file
        const cached = this.cache.getCachedResult(sourcePath, quality);
        if (cached) {
            if (onProgress) onProgress("ready", "Загружено из кэша");
            return cached;
        }

        // 2. Check if already running or queued
        const existing = this.queue.find(j => j.sourcePath === sourcePath) ||
                         Array.from(this.runningJobs.values()).find(j => j.sourcePath === sourcePath);

        if (existing) {
            if (onProgress) {
                existing.listeners.push((state, text) => onProgress(state, text));
            }
            return new Promise<PreviewResult>((resolve, reject) => {
                existing.listeners.push((state, text, res, err) => {
                    if (res) resolve(res);
                    else if (err) reject(new Error(err));
                });
            });
        }

        // 3. Create and enqueue Job
        const { glbPath } = this.cache.getCachePaths(sourcePath, quality);

        return new Promise<PreviewResult>((resolve, reject) => {
            const job: QueueJob = {
                id: Math.random().toString(36).substring(2, 9),
                sourcePath,
                options,
                state: "queued",
                statusText: "В очереди на конвертацию...",
                queuePosition: this.queue.length + 1,
                listeners: onProgress ? [(s, t) => onProgress(s, t)] : [],
                resolve,
                reject,
                cancelled: false
            };

            this.queue.push(job);
            this.notifyJob(job, "queued", `В очереди: ${job.queuePosition}`);
            this.processNext();
        });
    }

    public cancelJob(sourcePath: string) {
        const idx = this.queue.findIndex(j => j.sourcePath === sourcePath);
        if (idx !== -1) {
            const job = this.queue.splice(idx, 1)[0];
            job.cancelled = true;
            job.reject(new Error("Конвертация отменена пользователем."));
        }
    }

    public async forceRegenerate(
        sourcePath: string,
        options: PreviewOptions = {},
        onProgress?: (state: PreviewState, statusText: string) => void
    ): Promise<PreviewResult> {
        const quality = options.quality || this.settings.previewQuality;
        const { glbPath, metadataPath } = this.cache.getCachePaths(sourcePath, quality);

        // Delete cache entry
        const fs = require("fs");
        if (fs.existsSync(glbPath)) {
            try { fs.unlinkSync(glbPath); } catch {}
        }
        if (fs.existsSync(metadataPath)) {
            try { fs.unlinkSync(metadataPath); } catch {}
        }

        return this.getPreview(sourcePath, options, onProgress);
    }

    private async processNext() {
        const maxConcurrent = Math.max(1, this.settings.maxConcurrentConversions);
        if (this.runningJobs.size >= maxConcurrent || this.queue.length === 0) {
            return;
        }

        const job = this.queue.shift();
        if (!job || job.cancelled) {
            this.processNext();
            return;
        }

        this.runningJobs.set(job.id, job);

        const quality = job.options.quality || this.settings.previewQuality;
        const { glbPath } = this.cache.getCachePaths(job.sourcePath, quality);

        try {
            this.notifyJob(job, "openingNx", "Подготовка Siemens NX...");

            const progressTimer = setTimeout(() => {
                if (this.runningJobs.has(job.id)) {
                    this.notifyJob(job, "tessellating", "Тесселяция геометрических тел NX...");
                }
            }, 800);

            const result = await this.bridge.convert({
                source: job.sourcePath,
                output: glbPath,
                quality,
                nxPath: this.settings.nxPath,
                timeoutSeconds: this.settings.conversionTimeoutSeconds
            });

            clearTimeout(progressTimer);

            this.notifyJob(job, "ready", "Готово", result);
            job.resolve(result);
        } catch (err: any) {
            const msg = err.message || "Ошибка конвертации CAD-модели";
            this.notifyJob(job, "error", msg, undefined, msg);
            job.reject(err);
        } finally {
            this.runningJobs.delete(job.id);
            // Update remaining queue positions
            this.queue.forEach((q, idx) => {
                q.queuePosition = idx + 1;
                this.notifyJob(q, "queued", `В очереди: ${q.queuePosition}`);
            });
            this.processNext();
        }
    }

    private notifyJob(
        job: QueueJob,
        state: PreviewState,
        text: string,
        res?: PreviewResult,
        err?: string
    ) {
        job.state = state;
        job.statusText = text;
        job.listeners.forEach(fn => fn(state, text, res, err));
    }
}
