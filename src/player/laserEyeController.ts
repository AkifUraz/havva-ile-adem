import * as THREE from "three";
import type { FeedbackSystem } from "../world/feedbackSystem";
import type { LaserTarget } from "../world/laserTarget";

interface LaserEyeControllerOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  getAimPoint: (target: THREE.Vector2) => THREE.Vector2;
  getTargets: () => LaserTarget[];
  feedback: FeedbackSystem;
}

const maxLaserDistance = 120;

export class LaserEyeController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly getAimPoint: (target: THREE.Vector2) => THREE.Vector2;
  private readonly getTargets: () => LaserTarget[];
  private readonly feedback: FeedbackSystem;
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPoint = new THREE.Vector2();
  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();
  private readonly laserLine: THREE.Line;
  private isFiring = false;

  constructor(options: LaserEyeControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.getAimPoint = options.getAimPoint;
    this.getTargets = options.getTargets;
    this.feedback = options.feedback;
    this.laserLine = createLaserLine();
    this.laserLine.visible = false;
    options.scene.add(this.laserLine);

    this.domElement.addEventListener("contextmenu", this.preventContextMenu);
    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.domElement.addEventListener("pointercancel", this.handlePointerUp);
  }

  update(deltaSeconds: number): void {
    if (!this.isFiring) {
      this.laserLine.visible = false;
      return;
    }

    this.updateRay();
    const target = this.findTarget();
    const endPoint = target ? this.hitPoint : this.rayOrigin.clone().addScaledVector(this.rayDirection, maxLaserDistance);
    updateLaserLine(this.laserLine, this.rayOrigin, endPoint);
    this.laserLine.visible = true;

    if (!target) {
      return;
    }

    const result = target.applyLaserHit(this.hitPoint, deltaSeconds);
    this.feedback.shake(result.shakeAmount, result.isDestroyed ? 0.28 : 0.08);
  }

  dispose(): void {
    this.laserLine.removeFromParent();
    this.domElement.removeEventListener("contextmenu", this.preventContextMenu);
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("pointercancel", this.handlePointerUp);
  }

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 2) {
      return;
    }

    this.isFiring = true;
    event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.button === 2 || this.isFiring) {
      this.isFiring = false;
      event.preventDefault();
    }
  };

  private updateRay(): void {
    this.getAimPoint(this.aimPoint);
    this.raycaster.setFromCamera(this.aimPoint, this.camera);
    this.rayOrigin.copy(this.raycaster.ray.origin);
    this.rayDirection.copy(this.raycaster.ray.direction);
  }

  private findTarget(): LaserTarget | undefined {
    let bestTarget: LaserTarget | undefined;
    let bestAlong = Number.POSITIVE_INFINITY;

    this.getTargets().forEach((target) => {
      const toTarget = target.position.clone().sub(this.rayOrigin);
      const along = toTarget.dot(this.rayDirection);

      if (along < 4 || along > maxLaserDistance || along > bestAlong) {
        return;
      }

      const perpendicular = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
      if (perpendicular > target.radius) {
        return;
      }

      bestAlong = along;
      bestTarget = target;
    });

    if (bestTarget) {
      this.hitPoint.copy(this.rayOrigin).addScaledVector(this.rayDirection, bestAlong);
    }

    return bestTarget;
  }
}

function createLaserLine(): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const material = new THREE.LineBasicMaterial({ color: 0xff6f45, transparent: true, opacity: 0.82 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  return line;
}

function updateLaserLine(line: THREE.Line, start: THREE.Vector3, end: THREE.Vector3): void {
  const position = line.geometry.getAttribute("position");
  position.setXYZ(0, start.x, start.y, start.z);
  position.setXYZ(1, end.x, end.y, end.z);
  position.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}
