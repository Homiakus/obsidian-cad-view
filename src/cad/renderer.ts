import * as THREE from "three";
import { CameraProjection, DisplayMode, StandardView } from "./types";
import { ControlsManager } from "./controls-manager";
import { SelectionManager } from "./selection-manager";
import { SectionManager } from "./section-manager";
import { MeasurementManager } from "./measurement-manager";

export class CadRenderer {
    private container: HTMLElement;
    private canvasContainer: HTMLElement;

    private scene: THREE.Scene;
    private renderer: THREE.WebGLRenderer;
    private cameraPerspective: THREE.PerspectiveCamera;
    private cameraOrthographic: THREE.OrthographicCamera;
    private activeCamera: THREE.Camera;

    public controls: ControlsManager;
    public selection: SelectionManager;
    public section: SectionManager;
    public measurement: MeasurementManager;

    private modelRoot: THREE.Group = new THREE.Group();
    private edgesGroup: THREE.Group = new THREE.Group();
    private boundingBox: THREE.Box3 = new THREE.Box3();

    private displayMode: DisplayMode = "shadedEdges";
    private projection: CameraProjection = "orthographic";
    private backgroundMode: "theme" | "light" | "dark" | "transparent" = "theme";

    private isDirty: boolean = true;
    private animFrameId: number | null = null;
    private resizeObserver: ResizeObserver;

    constructor(container: HTMLElement, canvasContainer: HTMLElement) {
        this.container = container;
        this.canvasContainer = canvasContainer;

        // 1. Scene
        this.scene = new THREE.Scene();
        this.scene.add(this.modelRoot);
        this.scene.add(this.edgesGroup);

        // 2. Cameras
        const aspect = canvasContainer.clientWidth / Math.max(1, canvasContainer.clientHeight);
        this.cameraPerspective = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
        this.cameraOrthographic = new THREE.OrthographicCamera(-50 * aspect, 50 * aspect, 50, -50, 0.1, 2000);
        this.activeCamera = this.cameraOrthographic;

        // 3. WebGLRenderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
        this.renderer.shadowMap.enabled = false;
        canvasContainer.appendChild(this.renderer.domElement);

        // 4. Sub-managers
        this.controls = new ControlsManager(this.activeCamera, canvasContainer);
        this.controls.onChangeCallback = () => {
            this.measurement.updateBadgePosition();
            this.requestRender();
        };
        this.controls.onDoubleClickFit = () => {
            this.fit();
        };

        this.selection = new SelectionManager(this.scene, this.activeCamera, canvasContainer);
        this.selection.onRequestRender = () => this.requestRender();

        this.section = new SectionManager(this.renderer, this.scene);
        this.section.onRequestRender = () => this.requestRender();

        this.measurement = new MeasurementManager(this.scene, this.activeCamera, canvasContainer);
        this.measurement.onRequestRender = () => this.requestRender();

        // 5. Lighting, Axes & Background
        this.setupLighting();
        this.setupAxesHelper();
        this.updateBackground();

        // 6. Resize Observer
        this.resizeObserver = new ResizeObserver(() => this.handleResize());
        this.resizeObserver.observe(canvasContainer);

        // 7. Start on-demand render loop
        this.startRenderLoop();
    }

    private setupLighting() {
        const ambLight = new THREE.AmbientLight(0xffffff, 0.65);
        ambLight.name = "__cad_helper_ambient";
        this.scene.add(ambLight);

        // Key light
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
        dirLight1.position.set(100, 150, 100);
        dirLight1.name = "__cad_helper_dir1";
        this.scene.add(dirLight1);

        // Fill light
        const dirLight2 = new THREE.DirectionalLight(0xddeeff, 0.45);
        dirLight2.position.set(-100, -50, -100);
        dirLight2.name = "__cad_helper_dir2";
        this.scene.add(dirLight2);

        // Top subtle light
        const dirLight3 = new THREE.DirectionalLight(0xffeedd, 0.3);
        dirLight3.position.set(0, 100, 0);
        dirLight3.name = "__cad_helper_dir3";
        this.scene.add(dirLight3);
    }

    private setupAxesHelper() {
        const axes = new THREE.AxesHelper(15);
        axes.name = "__cad_helper_axes";
        axes.position.set(0, 0, 0);
        this.scene.add(axes);
    }

    public updateBackground(mode?: "theme" | "light" | "dark" | "transparent") {
        if (mode) this.backgroundMode = mode;

        if (this.backgroundMode === "transparent") {
            this.scene.background = null;
            this.renderer.setClearColor(0x000000, 0);
        } else if (this.backgroundMode === "light") {
            this.scene.background = new THREE.Color(0xf1f3f5);
        } else if (this.backgroundMode === "dark") {
            this.scene.background = new THREE.Color(0x18181f);
        } else {
            // Theme Adaptive
            const isDark = document.body.classList.contains("theme-dark");
            this.scene.background = isDark ? new THREE.Color(0x18181f) : new THREE.Color(0xf5f6f8);
        }
        this.requestRender();
    }

    public setProjection(projection: CameraProjection) {
        this.projection = projection;
        const oldCam = this.activeCamera;

        if (projection === "orthographic") {
            this.activeCamera = this.cameraOrthographic;
        } else {
            this.activeCamera = this.cameraPerspective;
        }

        this.activeCamera.position.copy(oldCam.position);
        this.activeCamera.quaternion.copy(oldCam.quaternion);

        this.controls.updateCamera(this.activeCamera);
        this.selection.updateCamera(this.activeCamera);
        this.measurement.updateCamera(this.activeCamera);
        this.handleResize();
        this.requestRender();
    }

    public getProjection(): CameraProjection {
        return this.projection;
    }

    public setDisplayMode(mode: DisplayMode) {
        this.displayMode = mode;

        this.modelRoot.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__cad_helper")) {
                if (mode === "wireframe") {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.wireframe = true);
                    } else if (obj.material) {
                        obj.material.wireframe = true;
                    }
                } else {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.wireframe = false);
                    } else if (obj.material) {
                        obj.material.wireframe = false;
                    }
                }
            }
        });

        this.edgesGroup.visible = (mode === "shadedEdges");
        this.requestRender();
    }

    public getDisplayMode(): DisplayMode {
        return this.displayMode;
    }

    public setView(view: StandardView) {
        this.controls.setStandardView(view);
    }

    public fit() {
        this.controls.fit(this.boundingBox);
    }

    public async loadGlb(arrayBuffer: ArrayBuffer): Promise<void> {
        // Clear previous model
        this.clearModel();

        // Import GLTFLoader
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const loader = new GLTFLoader();

        return new Promise<void>((resolve, reject) => {
            loader.parse(arrayBuffer, "", (gltf) => {
                const loadedScene = gltf.scene;
                this.modelRoot.add(loadedScene);

                // Build Edges & Compute Bounds
                this.boundingBox.setFromObject(this.modelRoot);

                this.modelRoot.traverse((obj) => {
                    if (obj instanceof THREE.Mesh) {
                        obj.castShadow = false;
                        obj.receiveShadow = false;

                        // Create Sharp Edges
                        if (obj.geometry) {
                            const edgesGeo = new THREE.EdgesGeometry(obj.geometry, 28);
                            const edgesMat = new THREE.LineBasicMaterial({
                                color: 0x1e293b,
                                linewidth: 1
                            });
                            const edgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
                            edgesMesh.matrixAutoUpdate = false;
                            edgesMesh.matrix.copy(obj.matrixWorld);
                            this.edgesGroup.add(edgesMesh);
                        }
                    }
                });

                this.section.setBoundingBox(this.boundingBox);
                this.fit();
                this.setDisplayMode(this.displayMode);
                this.requestRender();
                resolve();
            }, (err) => {
                reject(err);
            });
        });
    }

    private clearModel() {
        this.selection.clearSelection();
        this.measurement.clear();

        // Dispose model meshes
        this.modelRoot.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                if (obj.geometry) obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else if (obj.material) {
                    obj.material.dispose();
                }
            }
        });

        // Dispose edges
        this.edgesGroup.traverse((obj) => {
            if (obj instanceof THREE.LineSegments) {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) obj.material.dispose();
            }
        });

        this.modelRoot.clear();
        this.edgesGroup.clear();
    }

    public handleResize() {
        const w = this.canvasContainer.clientWidth;
        const h = this.canvasContainer.clientHeight;
        if (w === 0 || h === 0) return;

        const aspect = w / h;

        this.cameraPerspective.aspect = aspect;
        this.cameraPerspective.updateProjectionMatrix();

        if (this.cameraOrthographic) {
            const frustumHeight = (this.cameraOrthographic.top - this.cameraOrthographic.bottom);
            const halfHeight = frustumHeight / 2;
            this.cameraOrthographic.left = -halfHeight * aspect;
            this.cameraOrthographic.right = halfHeight * aspect;
            this.cameraOrthographic.updateProjectionMatrix();
        }

        this.renderer.setSize(w, h);
        this.requestRender();
    }

    public requestRender() {
        this.isDirty = true;
    }

    private startRenderLoop() {
        const render = () => {
            this.animFrameId = requestAnimationFrame(render);
            if (this.isDirty) {
                this.isDirty = false;
                this.renderer.render(this.scene, this.activeCamera);
            }
        };
        this.animFrameId = requestAnimationFrame(render);
    }

    public dispose() {
        if (this.animFrameId !== null) {
            cancelAnimationFrame(this.animFrameId);
        }

        this.resizeObserver.disconnect();
        this.clearModel();
        this.controls.dispose();
        this.selection.dispose();
        this.section.dispose();
        this.measurement.dispose();
        this.renderer.dispose();
        if (this.renderer.domElement.parentElement) {
            this.renderer.domElement.remove();
        }
    }
}
