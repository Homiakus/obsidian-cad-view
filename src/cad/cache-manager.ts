import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { App, TFile } from "obsidian";
import { CadMetadata, PreviewResult, QualityLevel } from "./types";

export class CacheManager {
    private app: App;
    private cacheBaseDir: string;
    private fileWatchers: Map<string, NodeJS.Timeout> = new Map();
    private onFileInvalidatedCallback?: (filePath: string) => void;

    constructor(app: App, pluginDir?: string) {
        this.app = app;
        const basePath = pluginDir || path.join((app.vault.adapter as any).basePath || process.cwd(), ".obsidian", "plugins", "obsidian-cad-preview");
        this.cacheBaseDir = path.join(basePath, "cache");
        this.ensureCacheDir();
    }

    private ensureCacheDir() {
        if (!fs.existsSync(this.cacheBaseDir)) {
            try {
                fs.mkdirSync(this.cacheBaseDir, { recursive: true });
            } catch (err) {
                console.error("Failed to create CAD cache directory:", err);
            }
        }
    }

    public getCacheBaseDir(): string {
        return this.cacheBaseDir;
    }

    public generateCacheKey(absolutePath: string, quality: QualityLevel = "normal"): string {
        try {
            const normalized = path.normalize(absolutePath).toLowerCase();
            const stats = fs.statSync(absolutePath);
            const converterVersion = 1;

            const payload = `${normalized}|${stats.size}|${stats.mtimeMs}|${converterVersion}|${quality}`;
            return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
        } catch {
            return crypto.createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
        }
    }

    public getCachePaths(sourcePath: string, quality: QualityLevel = "normal"): { dir: string; glbPath: string; metadataPath: string } {
        try {
            const sourceDir = path.dirname(path.resolve(sourcePath));
            const modelBase = path.basename(sourcePath, path.extname(sourcePath));
            const serviceDir = path.join(sourceDir, ".cad-preview", modelBase);

            if (!fs.existsSync(serviceDir)) {
                fs.mkdirSync(serviceDir, { recursive: true });
            }

            return {
                dir: serviceDir,
                glbPath: path.join(serviceDir, `${modelBase}.glb`),
                metadataPath: path.join(serviceDir, `${modelBase}.metadata.json`)
            };
        } catch {
            // Fallback to plugin cache directory if source folder is read-only
            const cacheKey = this.generateCacheKey(sourcePath, quality);
            const dir = path.join(this.cacheBaseDir, cacheKey);
            if (!fs.existsSync(dir)) {
                try { fs.mkdirSync(dir, { recursive: true }); } catch {}
            }
            return {
                dir,
                glbPath: path.join(dir, "model.glb"),
                metadataPath: path.join(dir, "metadata.json")
            };
        }
    }

    public isCacheValid(sourcePath: string, quality: QualityLevel = "normal"): boolean {
        try {
            const { glbPath, metadataPath } = this.getCachePaths(sourcePath, quality);
            if (!fs.existsSync(glbPath) || !fs.existsSync(metadataPath)) {
                return false;
            }

            // Check if source file is newer than cached GLB
            const sourceStats = fs.statSync(sourcePath);
            const glbStats = fs.statSync(glbPath);

            // Valid if GLB was created after source file last modification
            return glbStats.mtimeMs >= sourceStats.mtimeMs && glbStats.size > 0;
        } catch {
            return false;
        }
    }

    public getCachedResult(sourcePath: string, quality: QualityLevel = "normal"): PreviewResult | null {
        if (!this.isCacheValid(sourcePath, quality)) {
            return null;
        }

        const { glbPath, metadataPath } = this.getCachePaths(sourcePath, quality);

        let metadata: CadMetadata | undefined;
        if (fs.existsSync(metadataPath)) {
            try {
                const raw = fs.readFileSync(metadataPath, "utf-8");
                metadata = JSON.parse(raw);
            } catch (err) {
                console.warn("Failed to parse cached metadata:", err);
            }
        }

        return {
            glbPath,
            metadataPath,
            fromCache: true,
            metadata
        };
    }

    public setInvalidationListener(callback: (filePath: string) => void) {
        this.onFileInvalidatedCallback = callback;
    }

    public notifyFileChanged(filePath: string, debounceMs: number = 2000) {
        if (this.fileWatchers.has(filePath)) {
            clearTimeout(this.fileWatchers.get(filePath)!);
        }

        const timer = setTimeout(() => {
            this.fileWatchers.delete(filePath);
            if (this.onFileInvalidatedCallback) {
                this.onFileInvalidatedCallback(filePath);
            }
        }, debounceMs);

        this.fileWatchers.set(filePath, timer);
    }

    public async getCacheSize(): Promise<{ bytes: number; formatted: string }> {
        let totalBytes = 0;
        if (!fs.existsSync(this.cacheBaseDir)) {
            return { bytes: 0, formatted: "0 KB" };
        }

        const calculateDirSize = (dir: string) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const full = path.join(dir, file);
                const stat = fs.statSync(full);
                if (stat.isDirectory()) {
                    calculateDirSize(full);
                } else {
                    totalBytes += stat.size;
                }
            }
        };

        try {
            calculateDirSize(this.cacheBaseDir);
        } catch { }

        const formatted = totalBytes > 1024 * 1024 * 1024
            ? `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
            : totalBytes > 1024 * 1024
                ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
                : `${(totalBytes / 1024).toFixed(1)} KB`;

        return { bytes: totalBytes, formatted };
    }

    public async clearCache(): Promise<void> {
        if (fs.existsSync(this.cacheBaseDir)) {
            try {
                fs.rmSync(this.cacheBaseDir, { recursive: true, force: true });
                this.ensureCacheDir();
            } catch (err) {
                console.error("Failed to clear cache directory:", err);
            }
        }
    }
}
