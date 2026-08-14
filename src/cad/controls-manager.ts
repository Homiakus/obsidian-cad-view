import * as THREE from "three";
import { CameraProjection, StandardView } from "./types";

export class ControlsManager {
    private domElement: HTMLElement;
    private camera: THREE.Camera;
    private target: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

    private isDragging: boolean = false;
    private dragMode: "orbit" | "pan" = "orbit";
    private previousPointerPosition = { x: 0, y: 0 };
    private spherical: THREE.Spherical = new THREE.Spherical(100, Math.PI / 3, Math.PI / 4);

    public onChangeCallback?: () => void;

    constructor(camera: THREE.Camera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.bindEvents();
        this.updateCameraFromSpherical();
    }

    public updateCamera(camera: THREE.Camera) {
        this.camera = camera;
        this.updateCameraFromSpherical();
    }

    private bindEvents() {
        this.domElement.addEventListener("mousedown", this.onMouseDown);
        this.domElement.addEventListener("wheel", this.onWheel, { passive: false });
        this.domElement.addEventListener("dblclick", this.onDoubleClick);
        this.domElement.addEventListener("contextmenu", this.onContextMenu);
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.onMouseUp);
    }

    public dispose() {
        this.domElement.removeEventListener("mousedown", this.onMouseDown);
        this.domElement.removeEventListener("wheel", this.onWheel);
        this.domElement.removeEventListener("dblclick", this.onDoubleClick);
        this.domElement.removeEventListener("contextmenu", this.onContextMenu);
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
    }

    private onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
    };

    private onMouseDown = (e: MouseEvent) => {
        this.isDragging = true;
        this.previousPointerPosition = { x: e.clientX, y: e.clientY };
        this.dragMode = e.button === 2 || e.shiftKey ? "pan" : "orbit";
    };

    private onMouseMove = (e: MouseEvent) => {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.previousPointerPosition.x;
        const deltaY = e.clientY - this.previousPointerPosition.y;
        this.previousPointerPosition = { x: e.clientX, y: e.clientY };

        if (this.dragMode === "orbit") {
            const rotateSpeed = 0.008;
            this.spherical.theta -= deltaX * rotateSpeed;
            this.spherical.phi -= deltaY * rotateSpeed;
            this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.spherical.phi));
            this.updateCameraFromSpherical();
        } else if (this.dragMode === "pan") {
            this.pan(deltaX, deltaY);
        }

        if (this.onChangeCallback) this.onChangeCallback();
    };

    private onMouseUp = () => {
        this.isDragging = false;
    };

    private onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 0.9 : 1.1;
        this.zoom(factor);
        if (this.onChangeCallback) this.onChangeCallback();
    };

    private onDoubleClick = () => {
        if (this.onDoubleClickFit) this.onDoubleClickFit();
    };

    public onDoubleClickFit?: () => void;

    private zoom(factor: number) {
        if (this.camera instanceof THREE.OrthographicCamera) {
            this.camera.zoom = Math.max(0.01, Math.min(500, this.camera.zoom / factor));
            this.camera.updateProjectionMatrix();
        } else if (this.camera instanceof THREE.PerspectiveCamera) {
            this.spherical.radius = Math.max(0.5, this.spherical.radius * factor);
            this.updateCameraFromSpherical();
        }
    }

    private pan(deltaX: number, deltaY: number) {
        const factor = (this.camera instanceof THREE.OrthographicCamera)
            ? 1 / this.camera.zoom
            : this.spherical.radius * 0.0015;

        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

        this.target.addScaledVector(right, -deltaX * factor);
        this.target.addScaledVector(up, deltaY * factor);

        this.updateCameraFromSpherical();
    }

    private updateCameraFromSpherical() {
        const offset = new THREE.Vector3().setFromSpherical(this.spherical);
        this.camera.position.copy(this.target).add(offset);
        this.camera.lookAt(this.target);
    }

    public fit(box: THREE.Box3) {
        if (box.isEmpty()) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 1.0);

        this.target.copy(center);
        this.spherical.radius = maxDim * 2.2;

        if (this.camera instanceof THREE.OrthographicCamera) {
            const aspect = this.domElement.clientWidth / Math.max(1, this.domElement.clientHeight);
            const frustumHeight = maxDim * 1.3;
            const frustumWidth = frustumHeight * aspect;

            this.camera.left = -frustumWidth / 2;
            this.camera.right = frustumWidth / 2;
            this.camera.top = frustumHeight / 2;
            this.camera.bottom = -frustumHeight / 2;
            this.camera.zoom = 1.0;
            this.camera.near = 0.1;
            this.camera.far = maxDim * 10;
            this.camera.updateProjectionMatrix();
        } else if (this.camera instanceof THREE.PerspectiveCamera) {
            this.camera.near = maxDim * 0.01;
            this.camera.far = maxDim * 20;
            this.camera.updateProjectionMatrix();
        }

        this.updateCameraFromSpherical();
        if (this.onChangeCallback) this.onChangeCallback();
    }

    public setStandardView(view: StandardView) {
        const r = this.spherical.radius;
        switch (view) {
            case "iso":
                this.spherical.set(r, Math.PI / 3, Math.PI / 4);
                break;
            case "front":
                this.spherical.set(r, Math.PI / 2, 0);
                break;
            case "back":
                this.spherical.set(r, Math.PI / 2, Math.PI);
                break;
            case "top":
                this.spherical.set(r, 0.001, 0);
                break;
            case "bottom":
                this.spherical.set(r, Math.PI - 0.001, 0);
                break;
            case "left":
                this.spherical.set(r, Math.PI / 2, -Math.PI / 2);
                break;
            case "right":
                this.spherical.set(r, Math.PI / 2, Math.PI / 2);
                break;
        }
        this.updateCameraFromSpherical();
        if (this.onChangeCallback) this.onChangeCallback();
    }
}
