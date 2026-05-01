import * as THREE from "three";
import { keepOutOfBuildings } from "./collisionUtils";

export interface DebrisPiece {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  radius: number;
}

const gravity = 28;
const maxPieces = 32;

export function createDebrisFromObject(scene: THREE.Scene, source: THREE.Object3D, impactVelocity: THREE.Vector3): DebrisPiece[] {
  const pieces: DebrisPiece[] = [];
  const origin = source.getWorldPosition(new THREE.Vector3());

  source.updateMatrixWorld(true);
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || pieces.length >= maxPieces) {
      return;
    }

    const piece = object.clone(false);
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
    const worldScale = object.getWorldScale(new THREE.Vector3());
    const outward = worldPosition.clone().sub(origin);

    if (outward.lengthSq() < 0.001) {
      outward.set(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5);
    }

    outward.normalize();
    piece.position.copy(worldPosition);
    piece.quaternion.copy(worldQuaternion);
    piece.scale.copy(worldScale);
    piece.castShadow = true;
    piece.receiveShadow = true;
    scene.add(piece);

    pieces.push({
      object: piece,
      velocity: impactVelocity.clone().multiplyScalar(0.32).addScaledVector(outward, 9 + Math.random() * 7).add(new THREE.Vector3(0, 8 + Math.random() * 7, 0)),
      angularVelocity: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9),
      radius: Math.max(0.35, Math.min(2.5, new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3()).length() * 0.18)),
    });
  });

  return pieces;
}

export function updateDebrisPieces(pieces: DebrisPiece[], deltaSeconds: number): void {
  pieces.forEach((piece) => {
    if (piece.velocity.lengthSq() < 0.01 && piece.object.position.y <= 0.12) {
      return;
    }

    piece.velocity.y -= gravity * deltaSeconds;
    piece.object.position.addScaledVector(piece.velocity, deltaSeconds);
    keepOutOfBuildings(piece.object.position, piece.radius);
    piece.object.rotation.x += piece.angularVelocity.x * deltaSeconds;
    piece.object.rotation.y += piece.angularVelocity.y * deltaSeconds;
    piece.object.rotation.z += piece.angularVelocity.z * deltaSeconds;

    if (piece.object.position.y <= 0.12) {
      piece.object.position.y = 0.12;
      piece.velocity.multiplyScalar(0.38);
      piece.velocity.y = Math.max(0, piece.velocity.y) * 0.18;
      piece.angularVelocity.multiplyScalar(0.62);

      if (piece.velocity.lengthSq() < 0.18) {
        piece.velocity.set(0, 0, 0);
        piece.angularVelocity.set(0, 0, 0);
      }
    }
  });
}

export function disposeDebris(scene: THREE.Scene, pieces: DebrisPiece[]): void {
  pieces.forEach((piece) => scene.remove(piece.object));
  pieces.length = 0;
}
