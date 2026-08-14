import * as THREE from "three";

export type SectionAxis = "X" | "Y" | "Z";

export class SectionManager {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private clippingPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

    private isEnabled: boolean = false;
    private axis: SectionAxis = "X";
    private isInverted: boolean = false;
    private positionNormalized: number = 0.5; // 0 to 1
    private boundingBox: THREE.Box3 = new THREE.Box3();

    public onRequestRender?: () => void;

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
        this.renderer = renderer;
        this.scene = scene;
    }

    public setBoundingBox(box: THREE.Box3) {
        this.boundingBox.copy(box);
        this.updatePlane();
    }

    public setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
        this.renderer.localClippingEnabled = enabled;

        if (enabled) {
            this.applyClippingToMaterials([this.clippingPlane]);
            this.updatePlane();
        } else {
            this.applyClippingToMaterials([]);
        }

        if (this.onRequestRender) this.onRequestRender();
    }

    public getIsEnabled(): boolean {
        return this.isEnabled;
    }

    public setAxis(axis: SectionAxis) {
        this.axis = axis;
        this.updatePlane();
        if (this.onRequestRender) this.onRequestRender();
    }

    public getAxis(): SectionAxis {
        return this.axis;
    }

    public setInverted(inverted: boolean) {
        this.isInverted = inverted;
        this.updatePlane();
        if (this.onRequestRender) this.onRequestRender();
    }

    public getIsInverted(): boolean {
        return this.isInverted;
    }

    public setPositionNormalized(val: number) {
        this.positionNormalized = Math.max(0, Math.min(1, val));
        this.updatePlane();
        if (this.onRequestRender) this.onRequestRender();
    }

    public getPositionNormalized(): number {
        return this.positionNormalized;
    }

    private updatePlane() {
        if (this.boundingBox.isEmpty()) return;

        const normal = new THREE.Vector3();
        let minVal = 0, maxVal = 0;

        switch (this.axis) {
            case "X":
                normal.set(1, 0, 0);
                minVal = this.boundingBox.min.x;
                maxVal = this.boundingBox.max.x;
                break;
            case "Y":
                normal.set(0, 1, 0);
                minVal = this.boundingBox.min.y;
                maxVal = this.boundingBox.max.y;
                break;
            case "Z":
                normal.set(0, 0, 1);
                minVal = this.boundingBox.min.z;
                maxVal = this.boundingBox.max.z;
                break;
        }

        if (this.isInverted) {
            normal.negate();
        }

        const currentPos = minVal + this.positionNormalized * (maxVal - minVal);
        const planeConstant = this.isInverted ? currentPos : -currentPos;

        this.clippingPlane.normal.copy(normal);
        this.clippingPlane.constant = planeConstant;
    }

    private applyClippingToMaterials(planes: THREE.Plane[]) {
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__cad_helper")) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        m.clippingPlanes = planes;
                        m.clipShadows = true;
                        m.needsUpdate = true;
                    });
                } else if (obj.material) {
                    obj.material.clippingPlanes = planes;
                    obj.material.clipShadows = true;
                    obj.material.needsUpdate = true;
                }
            }
        });
    }

    public dispose() {
        this.setEnabled(false);
    }
}
