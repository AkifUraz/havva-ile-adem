import * as THREE from "three";
import type { ForceTarget } from "../world/forceTarget";

interface ForcePowerControllerOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  getTargets: () => ForceTarget[];
  setHudProgress: (progress: number, isLocked: boolean) => void;
  setForceActive?: (isActive: boolean) => void;
}

const lockSeconds = 0.6;
const maxTargetDistance = 95;

export class ForcePowerController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly getTargets: () => ForceTarget[];
  private readonly setHudProgress: (progress: number, isLocked: boolean) => void;
  private readonly setForceActive?: (isActive: boolean) => void;
  private readonly cameraDirection = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly holdPosition = new THREE.Vector3();
  private readonly rayOrigin = new THREE.Vector3();
  private isHolding = false;
  private activePointerId: number | null = null;
  private hoveredTargetId = "";
  private lockProgress = 0;
  private holdDistance = 16;
  private lockedTarget?: ForceTarget;

  constructor(options: ForcePowerControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.getTargets = options.getTargets;
    this.setHudProgress = options.setHudProgress;
    this.setForceActive = options.setForceActive;

    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.domElement.addEventListener("pointercancel", this.handlePointerUp);
  }

  update(deltaSeconds: number): void {
    if (!this.isHolding) {
      this.resetLock();
      return;
    }

    if (this.lockedTarget) {
      this.updateHeldTarget();
      this.setHudProgress(1, true);
      this.setForceActive?.(true);
      return;
    }

    const target = this.findCenteredTarget();

    if (!target) {
      this.resetLock();
      return;
    }

    if (target.id !== this.hoveredTargetId) {
      this.hoveredTargetId = target.id;
      this.lockProgress = 0;
    }

    this.lockProgress = Math.min(1, this.lockProgress + deltaSeconds / lockSeconds);
    this.setHudProgress(this.lockProgress, false);
    this.setForceActive?.(this.lockProgress > 0.08);

    if (this.lockProgress >= 1) {
      this.lockedTarget = target;
      this.holdDistance = THREE.MathUtils.clamp(this.camera.position.distanceTo(target.object.getWorldPosition(this.targetPosition)), 10, 34);
      this.updateHeldTarget();
      this.setForceActive?.(true);
    }
  }

  dispose(): void {
    this.releaseHeldTarget();
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("pointercancel", this.handlePointerUp);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button > 0) {
      return;
    }

    this.isHolding = true;
    this.activePointerId = event.pointerId;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) {
      return;
    }

    this.isHolding = false;
    this.activePointerId = null;
    this.releaseHeldTarget();
    this.resetLock();
  };

  private updateHeldTarget(): void {
    if (!this.lockedTarget) {
      return;
    }

    this.camera.getWorldDirection(this.cameraDirection);
    this.holdPosition.copy(this.camera.position).addScaledVector(this.cameraDirection, this.holdDistance);
    this.holdPosition.y = Math.max(this.holdPosition.y, 3.2);
    this.lockedTarget.setForceHeld(true, this.holdPosition);
  }

  private releaseHeldTarget(): void {
    if (!this.lockedTarget) {
      return;
    }

    this.camera.getWorldDirection(this.cameraDirection);
    const launchSpeed = this.lockedTarget.type === "car" ? 38 : 31;
    const liftSpeed = this.lockedTarget.type === "car" ? 17 : 14;
    const impulse = this.cameraDirection.clone().multiplyScalar(launchSpeed);
    impulse.y += liftSpeed;
    this.lockedTarget.setForceHeld(false);
    this.lockedTarget.applyForceImpulse(impulse);
    this.lockedTarget = undefined;
    this.setForceActive?.(false);
  }

  private resetLock(): void {
    if (this.lockedTarget) {
      return;
    }

    this.hoveredTargetId = "";
    this.lockProgress = 0;
    this.setHudProgress(0, false);
    this.setForceActive?.(false);
  }

  private findCenteredTarget(): ForceTarget | undefined {
    this.camera.getWorldDirection(this.cameraDirection);
    this.rayOrigin.copy(this.camera.position);

    let bestTarget: ForceTarget | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    this.getTargets().forEach((target) => {
      target.object.getWorldPosition(this.targetPosition);
      const toTarget = this.targetPosition.sub(this.rayOrigin);
      const along = toTarget.dot(this.cameraDirection);

      if (along < 3 || along > maxTargetDistance) {
        return;
      }

      const perpendicular = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
      const lockRadius = target.radius + along * 0.018;

      if (perpendicular > lockRadius) {
        return;
      }

      const score = perpendicular + along * 0.01;
      if (score < bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    });

    return bestTarget;
  }
}
