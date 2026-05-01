import { buildingColliders, cityBounds } from "./cityLayout";

interface PositionLike {
  x: number;
  z: number;
}

export function keepOutOfBuildings(position: PositionLike, radius: number): void {
  buildingColliders.forEach((collider) => {
    const minX = collider.minX - radius;
    const maxX = collider.maxX + radius;
    const minZ = collider.minZ - radius;
    const maxZ = collider.maxZ + radius;

    if (position.x <= minX || position.x >= maxX || position.z <= minZ || position.z >= maxZ) {
      return;
    }

    const pushLeft = Math.abs(position.x - minX);
    const pushRight = Math.abs(maxX - position.x);
    const pushBack = Math.abs(position.z - minZ);
    const pushForward = Math.abs(maxZ - position.z);
    const smallestPush = Math.min(pushLeft, pushRight, pushBack, pushForward);

    if (smallestPush === pushLeft) {
      position.x = minX;
    } else if (smallestPush === pushRight) {
      position.x = maxX;
    } else if (smallestPush === pushBack) {
      position.z = minZ;
    } else {
      position.z = maxZ;
    }
  });

  position.x = Math.max(cityBounds.minX, Math.min(cityBounds.maxX, position.x));
  position.z = Math.max(cityBounds.minZ, Math.min(cityBounds.maxZ, position.z));
}
