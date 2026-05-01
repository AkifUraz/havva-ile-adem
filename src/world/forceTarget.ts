import * as THREE from "three";

export type ForceTargetType = "npc" | "car";

export interface ForceTarget {
  id: string;
  type: ForceTargetType;
  object: THREE.Object3D;
  radius: number;
  isAvailable?(): boolean;
  setForceHeld(isHeld: boolean, holdPosition?: THREE.Vector3): void;
  applyForceImpulse(velocity: THREE.Vector3): void;
}
