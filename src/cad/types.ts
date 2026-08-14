/**
 * Unified CAD Preview Types and Interfaces
 */

export type CadFormat = "prt" | "step" | "stp" | "jt";

export type QualityLevel = "draft" | "normal" | "high" | "ultra";

export type CameraProjection = "orthographic" | "perspective";

export type StandardView = "iso" | "front" | "back" | "top" | "bottom" | "left" | "right";

export type DisplayMode = "shaded" | "shadedEdges" | "wireframe";

export type PreviewState = 
    | "idle"
    | "queued"
    | "openingNx"
    | "loadingCad"
    | "tessellating"
    | "exporting"
    | "optimizing"
    | "ready"
    | "stale"
    | "error";

export interface PreviewOptions {
    quality?: QualityLevel;
    width?: string;
    height?: number;
    projection?: CameraProjection;
    defaultView?: StandardView;
    showEdges?: boolean;
    backgroundColor?: string;
}

export interface PreviewResult {
    glbPath: string;
    metadataPath: string;
    fromCache: boolean;
    metadata?: CadMetadata;
    durationMs?: number;
}

export interface BoundingBox {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
}

export interface CadNode {
    id: string;
    name: string;
    nxId?: string;
    type: "assembly" | "component" | "body";
    transform?: number[];
    visible: boolean;
    color?: [number, number, number, number];
    material?: string;
    density?: number;
    mass?: number;
    children: CadNode[];
    meshIndex?: number;
}

export interface CadMetadata {
    source: string;
    format: string;
    units: string;
    generatedAt: string;
    sourceMtime: number;
    sourceSize: number;
    converterVersion: number;
    nxVersion?: string;
    componentCount: number;
    bodyCount: number;
    triangleCount: number;
    boundingBox?: BoundingBox;
    assemblyTree?: CadNode;
}

export interface NxDetectInfo {
    isFound: boolean;
    baseDir?: string;
    ugiiDir?: string;
    runJournalExe?: string;
    ugrafExe?: string;
    version?: string;
    supportsPrt: boolean;
    supportsStep: boolean;
    supportsJt: boolean;
    batchExecutionAvailable: boolean;
    detectionSource?: string;
}

export interface PluginSettings {
    nxPath: string;
    previewQuality: QualityLevel;
    defaultView: StandardView;
    defaultProjection: CameraProjection;
    showEdges: boolean;
    autoUpdate: boolean;
    autoUpdateDebounceMs: number;
    maxConcurrentConversions: number;
    conversionTimeoutSeconds: number;
    triangleWarningThreshold: number;
    enableLazyLoading: boolean;
    backgroundMode: "theme" | "light" | "dark" | "transparent";
    bridgeExecutablePath?: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    nxPath: "",
    previewQuality: "normal",
    defaultView: "iso",
    defaultProjection: "orthographic",
    showEdges: true,
    autoUpdate: true,
    autoUpdateDebounceMs: 2000,
    maxConcurrentConversions: 1,
    conversionTimeoutSeconds: 120,
    triangleWarningThreshold: 10000000,
    enableLazyLoading: true,
    backgroundMode: "theme"
};
