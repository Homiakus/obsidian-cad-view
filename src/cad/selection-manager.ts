import * as THREE from "three";

export interface SelectedComponentInfo {
    uuid: string;
    name: string;
    mesh: THREE.Mesh;
    originalMaterial: THREE.Material | THREE.Material[];
    extras?: Record<string, any>;
}

export class SelectionManager {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private domElement: HTMLElement;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();

    private selectedInfo: SelectedComponentInfo | null = null;
    private highlightMaterial: THREE.MeshStandardMaterial;

    public onSelectionChange?: (info: SelectedComponentInfo | null) => void;
    public onRequestRender?: () => void;

    private isGhostMode: boolean = false;
    private hiddenUuids: Set<string> = new Set();

    constructor(scene: THREE.Scene, camera: THREE.Camera, domElement: HTMLElement) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;

        this.highlightMaterial = new THREE.MeshStandardMaterial({
            color: 0xffaa00,
            emissive: 0x553300,
            roughness: 0.3,
            metalness: 0.8
        });

        this.domElement.addEventListener("click", this.onClick);
    }

    public updateCamera(camera: THREE.Camera) {
        this.camera = camera;
    }

    public dispose() {
        this.domElement.removeEventListener("click", this.onClick);
        this.highlightMaterial.dispose();
    }

    private onClick = (e: MouseEvent) => {
        // Prevent click when dragging
        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        const hit = intersects.find(i => i.object instanceof THREE.Mesh && !i.object.name.startsWith("__cad_helper"));
        if (hit && hit.object instanceof THREE.Mesh) {
            this.selectObject(hit.object);
        } else {
            this.clearSelection();
        }
    };

    public selectObject(mesh: THREE.Mesh) {
        this.restoreMaterials();

        this.selectedInfo = {
            uuid: mesh.uuid,
            name: mesh.name || "Component",
            mesh: mesh,
            originalMaterial: mesh.material,
            extras: (mesh.userData as any)?.extras
        };

        // Apply highlight
        mesh.material = this.highlightMaterial;

        if (this.isGhostMode) {
            this.applyGhostMode(mesh);
        }

        if (this.onSelectionChange) this.onSelectionChange(this.selectedInfo);
        if (this.onRequestRender) this.onRequestRender();
    }

    public selectByNameOrId(idOrName: string) {
        let found: THREE.Mesh | null = null;
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && (obj.uuid === idOrName || obj.name === idOrName || obj.userData?.id === idOrName)) {
                found = obj;
            }
        });

        if (found) {
            this.selectObject(found);
        } else {
            this.clearSelection();
        }
    }

    public clearSelection() {
        this.restoreMaterials();
        this.selectedInfo = null;
        if (this.onSelectionChange) this.onSelectionChange(null);
        if (this.onRequestRender) this.onRequestRender();
    }

    public toggleGhostMode() {
        this.isGhostMode = !this.isGhostMode;
        if (this.selectedInfo) {
            if (this.isGhostMode) {
                this.applyGhostMode(this.selectedInfo.mesh);
            } else {
                this.restoreMaterials();
                this.selectedInfo.mesh.material = this.highlightMaterial;
            }
        }
        if (this.onRequestRender) this.onRequestRender();
    }

    public isolateSelected() {
        if (!this.selectedInfo) return;
        const target = this.selectedInfo.mesh;

        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__cad_helper")) {
                obj.visible = (obj === target);
            }
        });

        if (this.onRequestRender) this.onRequestRender();
    }

    public resetVisibility() {
        this.hiddenUuids.clear();
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__cad_helper")) {
                obj.visible = true;
            }
        });
        if (this.onRequestRender) this.onRequestRender();
    }

    public toggleVisibility(uuid: string, visible?: boolean) {
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && (obj.uuid === uuid || obj.userData?.id === uuid)) {
                const targetVis = visible !== undefined ? visible : !obj.visible;
                obj.visible = targetVis;
                if (!targetVis) this.hiddenUuids.add(uuid);
                else this.hiddenUuids.delete(uuid);
            }
        });
        if (this.onRequestRender) this.onRequestRender();
    }

    private applyGhostMode(focusMesh: THREE.Mesh) {
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__cad_helper") && obj !== focusMesh) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        m.transparent = true;
                        m.opacity = 0.15;
                    });
                } else if (obj.material) {
                    obj.material.transparent = true;
                    obj.material.opacity = 0.15;
                }
            }
        });
    }

    private restoreMaterials() {
        if (this.selectedInfo && this.selectedInfo.mesh) {
            this.selectedInfo.mesh.material = this.selectedInfo.originalMaterial;
        }

        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__cad_helper")) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        if (!m.userData?.isOriginalTransparent) {
                            m.transparent = false;
                            m.opacity = 1.0;
                        }
                    });
                } else if (obj.material) {
                    if (!obj.material.userData?.isOriginalTransparent) {
                        obj.material.transparent = false;
                        obj.material.opacity = 1.0;
                    }
                }
            }
        });
    }
}
