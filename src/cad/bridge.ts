import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { NxDetectInfo, PreviewResult, QualityLevel } from "./types";

export interface BridgeJobParams {
    source: string;
    output: string;
    quality?: QualityLevel;
    nxPath?: string;
    timeoutSeconds?: number;
}

export class CadBridge {
    private bridgeExePath: string | null = null;
    private pluginDir: string | null = null;

    constructor(customBridgePath?: string, pluginDir?: string) {
        this.pluginDir = pluginDir || null;
        this.resolveBridgePath(customBridgePath);
    }

    public updateBridgePath(customBridgePath?: string, pluginDir?: string) {
        if (pluginDir) this.pluginDir = pluginDir;
        this.resolveBridgePath(customBridgePath);
    }

    private resolveBridgePath(customPath?: string) {
        if (customPath && fs.existsSync(customPath)) {
            this.bridgeExePath = customPath;
            return;
        }

        const candidatePaths = [
            // If pluginDir is specified
            ...(this.pluginDir ? [
                path.join(this.pluginDir, "bin", "bridge", "cad-preview-bridge.exe"),
                path.join(this.pluginDir, "cad-preview-bridge.exe")
            ] : []),
            // CommonJS __dirname
            ...(typeof __dirname !== "undefined" ? [
                path.join(__dirname, "bin", "bridge", "cad-preview-bridge.exe"),
                path.join(__dirname, "cad-preview-bridge.exe")
            ] : []),
            // Known development paths
            "D:\\Programms\\obsidian-cad\\bin\\bridge\\cad-preview-bridge.exe",
            "D:\\Programms\\obsidian-cad\\test-vault\\.obsidian\\plugins\\obsidian-cad-preview\\bin\\bridge\\cad-preview-bridge.exe",
            path.join(process.cwd(), "bin", "bridge", "cad-preview-bridge.exe"),
            "cad-preview-bridge.exe"
        ];

        for (const candidate of candidatePaths) {
            if (fs.existsSync(candidate)) {
                this.bridgeExePath = candidate;
                return;
            }
        }

        this.bridgeExePath = candidatePaths[0];
    }

    public async testNx(explicitPath?: string): Promise<NxDetectInfo> {
        return new Promise((resolve) => {
            const args = ["test-nx"];
            if (explicitPath) {
                args.push("--nx-path", explicitPath);
            }

            this.runProcess(args, (stdout, stderr, code) => {
                try {
                    let cleanJson = stdout.trim();
                    const startIdx = cleanJson.indexOf("{");
                    const endIdx = cleanJson.lastIndexOf("}");
                    if (startIdx !== -1 && endIdx !== -1) {
                        cleanJson = cleanJson.slice(startIdx, endIdx + 1);
                    }
                    const parsed = JSON.parse(cleanJson);
                    resolve({
                        isFound: parsed.isFound ?? parsed.IsFound ?? false,
                        baseDir: parsed.baseDir ?? parsed.BaseDir,
                        ugiiDir: parsed.ugiiDir ?? parsed.UgiiDir,
                        runJournalExe: parsed.runJournalExe ?? parsed.RunJournalExe,
                        ugrafExe: parsed.ugrafExe ?? parsed.UgrafExe,
                        version: parsed.version ?? parsed.Version,
                        supportsPrt: parsed.supportsPrt ?? parsed.SupportsPrt ?? true,
                        supportsStep: parsed.supportsStep ?? parsed.SupportsStep ?? true,
                        supportsJt: parsed.supportsJt ?? parsed.SupportsJt ?? true,
                        batchExecutionAvailable: parsed.batchExecutionAvailable ?? parsed.BatchExecutionAvailable ?? false,
                        detectionSource: parsed.detectionSource ?? parsed.DetectionSource
                    });
                } catch {
                    resolve({
                        isFound: false,
                        supportsPrt: true,
                        supportsStep: true,
                        supportsJt: true,
                        batchExecutionAvailable: false,
                        detectionSource: stderr || "Bridge failed to parse output"
                    });
                }
            });
        });
    }

    public async convert(params: BridgeJobParams): Promise<PreviewResult> {
        return new Promise((resolve, reject) => {
            const args = ["convert", params.source, "--output", params.output];
            if (params.quality) args.push("--quality", params.quality);
            if (params.nxPath) args.push("--nx-path", params.nxPath);
            if (params.timeoutSeconds) args.push("--timeout", params.timeoutSeconds.toString());

            this.runProcess(args, (stdout, stderr, code) => {
                try {
                    let cleanJson = stdout.trim();
                    const startIdx = cleanJson.indexOf("{");
                    const endIdx = cleanJson.lastIndexOf("}");
                    if (startIdx !== -1 && endIdx !== -1) {
                        cleanJson = cleanJson.slice(startIdx, endIdx + 1);
                    }
                    const parsed = JSON.parse(cleanJson);
                    const isSuccess = parsed.success ?? parsed.Success ?? false;
                    const glbPath = parsed.glbPath ?? parsed.GlbPath;
                    const metadataPath = parsed.metadataPath ?? parsed.MetadataPath;
                    const metadata = parsed.metadata ?? parsed.Metadata;
                    const durationMs = parsed.durationMs ?? parsed.DurationMs;
                    const errorMessage = parsed.errorMessage ?? parsed.ErrorMessage;
                    const errorCode = parsed.errorCode ?? parsed.ErrorCode;

                    if (isSuccess && glbPath) {
                        resolve({
                            glbPath,
                            metadataPath: metadataPath || "",
                            fromCache: false,
                            metadata,
                            durationMs
                        });
                    } else {
                        reject(new Error(errorMessage || `Conversion failed with code ${errorCode || code}`));
                    }
                } catch (e) {
                    if (fs.existsSync(params.output)) {
                        resolve({
                            glbPath: params.output,
                            metadataPath: params.output.replace(/\.glb$/i, ".metadata.json"),
                            fromCache: false
                        });
                    } else {
                        reject(new Error(stderr || stdout || `Process exited with code ${code}`));
                    }
                }
            });
        });
    }

    private runProcess(args: string[], callback: (stdout: string, stderr: string, code: number) => void) {
        let exe = this.bridgeExePath;
        let finalArgs = args;

        if (!exe || !fs.existsSync(exe)) {
            // Try running with dotnet if .exe is not published
            exe = "dotnet";
            const csproj = path.join(process.cwd(), "bridge", "CadPreviewBridge", "CadPreviewBridge.csproj");
            if (fs.existsSync(csproj)) {
                finalArgs = ["run", "--project", csproj, "--", ...args];
            }
        }

        try {
            const proc = spawn(exe, finalArgs, {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            });

            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (data) => {
                stdout += data.toString();
            });

            proc.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            proc.on("close", (code) => {
                callback(stdout.trim(), stderr.trim(), code ?? 0);
            });

            proc.on("error", (err) => {
                callback("", err.message, -1);
            });
        } catch (err: any) {
            callback("", err.message || "Failed to spawn process", -1);
        }
    }
}
