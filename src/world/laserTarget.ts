import * as THREE from "three";

export interface LaserHitResult {
  isDestroyed: boolean;
  feedbackPosition: THREE.Vector3;
  shakeAmount: number;
}

export interface LaserTarget {
  id: string;
  object: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
  applyLaserHit(hitPoint: THREE.Vector3, deltaSeconds: number): LaserHitResult;
}
