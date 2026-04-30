import * as THREE from "three";
import type { CityBounds, ColliderRect } from "../world/cityLayout";

interface WalkControllerOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  lockElement: HTMLElement;
  bounds: CityBounds;
  colliders: ColliderRect[];
  onLockChange?: (isLocked: boolean) => void;
}

const moveKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);

export class WalkController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly lockElement: HTMLElement;
  private readonly bounds: CityBounds;
  private readonly colliders: ColliderRect[];
  private readonly onLockChange?: (isLocked: boolean) => void;
  private readonly pressed = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly nextPosition = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private isLocked = false;
  private readonly playerRadius = 2.1;
  private readonly eyeHeight = 3.2;
  private readonly speed = 22;

  constructor(options: WalkControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.lockElement = options.lockElement;
    this.bounds = options.bounds;
    this.colliders = options.colliders;
    this.onLockChange = options.onLockChange;

    this.camera.position.set(0, this.eyeHeight, 96);
    this.camera.rotation.order = "YXZ";
    this.yaw = 0;

    this.lockElement.addEventListener("click", this.requestLock);
    this.domElement.addEventListener("click", this.requestLock);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
  }

  update(deltaSeconds: number): void {
    const forward = Number(this.pressed.has("KeyW") || this.pressed.has("ArrowUp")) - Number(this.pressed.has("KeyS") || this.pressed.has("ArrowDown"));
    const strafe = Number(this.pressed.has("KeyD") || this.pressed.has("ArrowRight")) - Number(this.pressed.has("KeyA") || this.pressed.has("ArrowLeft"));

    this.velocity.set(0, 0, 0);

    if (forward !== 0 || strafe !== 0) {
      const direction = new THREE.Vector3(strafe, 0, -forward).normalize();
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.velocity.copy(direction.multiplyScalar(this.speed * deltaSeconds));
    }

    this.moveAxis(this.velocity.x, 0);
    this.moveAxis(0, this.velocity.z);

    this.camera.position.y = this.eyeHeight;
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  dispose(): void {
    this.lockElement.removeEventListener("click", this.requestLock);
    this.domElement.removeEventListener("click", this.requestLock);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
  }

  getPositionLabel(): string {
    const { x, z } = this.camera.position;
    return `${x.toFixed(1)}, ${z.toFixed(1)}`;
  }

  private readonly requestLock = (): void => {
    if (document.pointerLockElement !== this.domElement) {
      void this.domElement.requestPointerLock();
    }
  };

  private readonly handlePointerLockChange = (): void => {
    this.isLocked = document.pointerLockElement === this.domElement;
    this.onLockChange?.(this.isLocked);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isLocked) {
      return;
    }

    this.yaw -= event.movementX * 0.0022;
    this.pitch -= event.movementY * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.15, 1.05);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (moveKeys.has(event.code)) {
      this.pressed.add(event.code);
      event.preventDefault();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (moveKeys.has(event.code)) {
      this.pressed.delete(event.code);
      event.preventDefault();
    }
  };

  private moveAxis(deltaX: number, deltaZ: number): void {
    this.nextPosition.copy(this.camera.position);
    this.nextPosition.x = THREE.MathUtils.clamp(this.nextPosition.x + deltaX, this.bounds.minX, this.bounds.maxX);
    this.nextPosition.z = THREE.MathUtils.clamp(this.nextPosition.z + deltaZ, this.bounds.minZ, this.bounds.maxZ);

    if (!this.intersectsBuilding(this.nextPosition.x, this.nextPosition.z)) {
      this.camera.position.copy(this.nextPosition);
    }
  }

  private intersectsBuilding(x: number, z: number): boolean {
    return this.colliders.some(
      (collider) =>
        x > collider.minX - this.playerRadius &&
        x < collider.maxX + this.playerRadius &&
        z > collider.minZ - this.playerRadius &&
        z < collider.maxZ + this.playerRadius,
    );
  }
}
