import * as THREE from "three";

export class MeasurementManager {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private domElement: HTMLElement;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();

    private isEnabled: boolean = false;
    private points: THREE.Vector3[] = [];
    private units: string = "mm";

    private marker1: THREE.Mesh;
    private marker2: THREE.Mesh;
    private line: THREE.Line;
    private badgeElement: HTMLElement;

    public onRequestRender?: () => void;

    constructor(scene: THREE.Scene, camera: THREE.Camera, domElement: HTMLElement, units: string = "mm") {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.units = units;

        // Visual Markers
        const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        this.marker1 = new THREE.Mesh(sphereGeo, markerMat);
        this.marker2 = new THREE.Mesh(sphereGeo, markerMat);
        this.marker1.name = "__cad_helper_marker1";
        this.marker2.name = "__cad_helper_marker2";
        this.marker1.visible = false;
        this.marker2.visible = false;
        this.scene.add(this.marker1);
        this.scene.add(this.marker2);

        // Visual Line
        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const lineMat = new THREE.LineDashedMaterial({ color: 0xef4444, dashSize: 2, gapSize: 1 });
        this.line = new THREE.Line(lineGeo, lineMat);
        this.line.name = "__cad_helper_line";
        this.line.visible = false;
        this.scene.add(this.line);

        // Badge Overlay
        this.badgeElement = document.createElement("div");
        this.badgeElement.className = "cad-measure-badge";
        this.badgeElement.style.display = "none";
        this.domElement.appendChild(this.badgeElement);

        this.domElement.addEventListener("click", this.onClick);
    }

    public updateCamera(camera: THREE.Camera) {
        this.camera = camera;
        this.updateBadgePosition();
    }

    public setUnits(units: string) {
        this.units = units;
        this.updateBadgeText();
    }

    public setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.clear();
        }
        if (this.onRequestRender) this.onRequestRender();
    }

    public getIsEnabled(): boolean {
        return this.isEnabled;
    }

    public clear() {
        this.points = [];
        this.marker1.visible = false;
        this.marker2.visible = false;
        this.line.visible = false;
        this.badgeElement.style.display = "none";
        if (this.onRequestRender) this.onRequestRender();
    }

    private onClick = (e: MouseEvent) => {
        if (!this.isEnabled) return;

        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        const hit = intersects.find(i => i.object instanceof THREE.Mesh && !i.object.name.startsWith("__cad_helper"));
        if (!hit) return;

        if (this.points.length >= 2) {
            this.points = [];
        }

        this.points.push(hit.point.clone());

        if (this.points.length === 1) {
            this.marker1.position.copy(this.points[0]);
            this.marker1.visible = true;
            this.marker2.visible = false;
            this.line.visible = false;
            this.badgeElement.style.display = "none";
        } else if (this.points.length === 2) {
            this.marker2.position.copy(this.points[1]);
            this.marker2.visible = true;

            const positions = new Float32Array([
                this.points[0].x, this.points[0].y, this.points[0].z,
                this.points[1].x, this.points[1].y, this.points[1].z
            ]);
            this.line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            (this.line.geometry as any).computeBoundingSphere();
            this.line.visible = true;

            this.updateBadgeText();
            this.updateBadgePosition();
            this.badgeElement.style.display = "block";
        }

        if (this.onRequestRender) this.onRequestRender();
    };

    private updateBadgeText() {
        if (this.points.length < 2) return;
        const dist = this.points[0].distanceTo(this.points[1]);
        this.badgeElement.textContent = `📏 ${dist.toFixed(2)} ${this.units}`;
    }

    public updateBadgePosition() {
        if (this.points.length < 2 || this.badgeElement.style.display === "none") return;

        const mid = new THREE.Vector3().addVectors(this.points[0], this.points[1]).multiplyScalar(0.5);
        const screenPos = mid.clone().project(this.camera);

        const rect = this.domElement.getBoundingClientRect();
        const x = (screenPos.x * 0.5 + 0.5) * rect.width;
        const y = (-screenPos.y * 0.5 + 0.5) * rect.height;

        this.badgeElement.style.left = `${x}px`;
        this.badgeElement.style.top = `${y}px`;
    }

    public dispose() {
        this.domElement.removeEventListener("click", this.onClick);
        this.marker1.geometry.dispose();
        this.marker2.geometry.dispose();
        this.line.geometry.dispose();
        this.badgeElement.remove();
    }
}
