import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cityBounds } from "./cityLayout";
import { keepOutOfBuildings } from "./collisionUtils";
import { createDebrisFromObject, disposeDebris, type DebrisPiece, updateDebrisPieces } from "./debrisSystem";
import { resolveAssetUrl } from "./assetResolver";
import type { ForceTarget } from "./forceTarget";

interface TrafficRoute {
  assetId: string;
  speed: number;
  length: number;
  points: Array<{ x: number; z: number }>;
}

interface TrafficCar {
  root: THREE.Group;
  route: TrafficRoute;
  targetIndex: number;
  wheels: THREE.Object3D[];
  waiting: boolean;
  forceHeld: boolean;
  forceVelocity: THREE.Vector3;
  forcePeakY: number;
  shattered: boolean;
  respawnTime: number;
}

export interface TrafficCollider {
  x: number;
  z: number;
  yaw: number;
  halfLength: number;
  halfWidth: number;
}

export interface CarTrafficSystem {
  update(deltaSeconds: number, playerPosition?: THREE.Vector3): void;
  getColliders(): TrafficCollider[];
  getForceTargets(): ForceTarget[];
  setPanic(isPanicking: boolean): void;
  dispose(): void;
}

const trafficRoutes: TrafficRoute[] = [
  {
    assetId: "sedan",
    speed: 9.5,
    length: 10.2,
    points: [
      { x: -106, z: -4.5 },
      { x: -46, z: -4.5 },
      { x: 0, z: -4.5 },
      { x: 46, z: -4.5 },
      { x: 106, z: -4.5 },
    ],
  },
  {
    assetId: "taxi",
    speed: 8.8,
    length: 10,
    points: [
      { x: 106, z: 4.5 },
      { x: 46, z: 4.5 },
      { x: 0, z: 4.5 },
      { x: -46, z: 4.5 },
      { x: -106, z: 4.5 },
    ],
  },
  {
    assetId: "van",
    speed: 7.4,
    length: 12.2,
    points: [
      { x: -50.5, z: 106 },
      { x: -50.5, z: 46 },
      { x: -50.5, z: 0 },
      { x: -50.5, z: -46 },
      { x: -50.5, z: -106 },
    ],
  },
  {
    assetId: "suv",
    speed: 8.1,
    length: 10.2,
    points: [
      { x: 50.5, z: -106 },
      { x: 50.5, z: -46 },
      { x: 50.5, z: 0 },
      { x: 50.5, z: 46 },
      { x: 50.5, z: 106 },
    ],
  },
  {
    assetId: "delivery",
    speed: 6.5,
    length: 13.4,
    points: [
      { x: -106, z: 41.5 },
      { x: -46, z: 41.5 },
      { x: 0, z: 41.5 },
      { x: 46, z: 41.5 },
      { x: 106, z: 41.5 },
    ],
  },
];

export async function createCarTrafficSystem(scene: THREE.Scene, onShatter?: () => void): Promise<CarTrafficSystem> {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) => {
    return url.endsWith("Textures/colormap.png") ? resolveAssetUrl("/assets/cars/Textures/colormap.png") : url;
  });

  const loader = new GLTFLoader(loadingManager);
  const cars = await Promise.all(
    trafficRoutes.map(async (route) => {
      const gltf = await loader.loadAsync(resolveAssetUrl(`/assets/cars/${route.assetId}.glb`));
      const root = normalizeCarModel(gltf.scene, route.length);
      const firstPoint = route.points[0];
      root.position.set(firstPoint.x, 0.2, firstPoint.z);
      faceNextPoint(root, firstPoint, route.points[1]);
      scene.add(root);

      return {
        root,
        route,
        targetIndex: 1,
        wheels: collectWheels(root),
        waiting: false,
        forceHeld: false,
        forceVelocity: new THREE.Vector3(),
        forcePeakY: 0.2,
        shattered: false,
        respawnTime: 0,
      };
    }),
  );
  const debrisPieces: DebrisPiece[] = [];
  let isPanicking = false;

  return {
    update(deltaSeconds: number, playerPosition?: THREE.Vector3) {
      const colliders = cars.map((car) => (car.shattered ? undefined : getTrafficCollider(car)));
      cars.forEach((car, index) => {
        const otherColliders = colliders.filter((collider, colliderIndex): collider is TrafficCollider => colliderIndex !== index && collider !== undefined);
        updateCar(car, deltaSeconds, otherColliders, scene, debrisPieces, isPanicking, onShatter, playerPosition);
        colliders[index] = car.shattered ? undefined : getTrafficCollider(car);
      });
      updateDebrisPieces(scene, debrisPieces, deltaSeconds);
    },
    getColliders() {
      return cars.filter((car) => !car.shattered && !car.forceHeld && car.root.position.y < 1.2).map((car) => getTrafficCollider(car));
    },
    getForceTargets() {
      return cars.filter((car) => !car.shattered).map((car, index) => createCarForceTarget(car, index));
    },
    setPanic(nextIsPanicking: boolean) {
      isPanicking = nextIsPanicking;
    },
    dispose() {
      cars.forEach((car) => scene.remove(car.root));
      disposeDebris(scene, debrisPieces);
    },
  };
}

function updateCar(
  car: TrafficCar,
  deltaSeconds: number,
  otherColliders: TrafficCollider[],
  scene: THREE.Scene,
  debrisPieces: DebrisPiece[],
  isPanicking: boolean,
  onShatter?: () => void,
  playerPosition?: THREE.Vector3,
): void {
  if (car.shattered) {
    updateCarRespawn(car, deltaSeconds);
    return;
  }

  if (car.forceHeld) {
    car.waiting = true;
    return;
  }

  if (car.forceVelocity.lengthSq() > 0.01 || car.root.position.y > 0.21) {
    updateForceMotion(car, deltaSeconds, scene, debrisPieces, onShatter);
    return;
  }

  if (isPanicking && playerPosition) {
    updatePanickedCar(car, deltaSeconds, otherColliders, playerPosition);
    return;
  }

  const target = car.route.points[car.targetIndex];
  const dx = target.x - car.root.position.x;
  const dz = target.z - car.root.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance < 0.6) {
    const previousPoint = car.route.points[car.targetIndex];
    car.targetIndex = (car.targetIndex + 1) % car.route.points.length;
    faceNextPoint(car.root, previousPoint, car.route.points[car.targetIndex]);
    return;
  }

  const directionX = dx / distance;
  const directionZ = dz / distance;
  const step = Math.min(distance, car.route.speed * deltaSeconds);
  const yaw = getHeadingYaw(directionX, directionZ);
  const nextCollider = getTrafficCollider(car, {
    x: car.root.position.x + directionX * step,
    z: car.root.position.z + directionZ * step,
    yaw,
  });

  if (otherColliders.some((collider) => trafficCollidersOverlap(nextCollider, collider))) {
    car.waiting = true;
    return;
  }

  car.waiting = false;
  car.root.position.x += directionX * step;
  car.root.position.z += directionZ * step;
  car.root.rotation.y = yaw;
  spinWheels(car.wheels, step);
}

function updatePanickedCar(car: TrafficCar, deltaSeconds: number, otherColliders: TrafficCollider[], playerPosition: THREE.Vector3): void {
  const awayX = car.root.position.x - playerPosition.x;
  const awayZ = car.root.position.z - playerPosition.z;
  const distance = Math.max(0.001, Math.hypot(awayX, awayZ));
  const directionX = awayX / distance;
  const directionZ = awayZ / distance;
  const step = Math.min(18 * deltaSeconds, 0.9);
  const yaw = getHeadingYaw(directionX, directionZ);
  const nextCollider = getTrafficCollider(car, {
    x: THREE.MathUtils.clamp(car.root.position.x + directionX * step, cityBounds.minX, cityBounds.maxX),
    z: THREE.MathUtils.clamp(car.root.position.z + directionZ * step, cityBounds.minZ, cityBounds.maxZ),
    yaw,
  });
  keepOutOfBuildings(nextCollider, car.route.length * 0.34);

  if (otherColliders.some((collider) => trafficCollidersOverlap(nextCollider, collider))) {
    car.waiting = true;
    return;
  }

  car.waiting = false;
  car.root.position.x = nextCollider.x;
  car.root.position.z = nextCollider.z;
  car.root.rotation.y = yaw;
  spinWheels(car.wheels, step);
}

function createCarForceTarget(car: TrafficCar, index: number): ForceTarget {
  return {
    id: `car-${index}`,
    type: "car",
    object: car.root,
    radius: car.route.length * 0.62,
    isAvailable() {
      return !car.shattered;
    },
    setForceHeld(isHeld: boolean, holdPosition?: THREE.Vector3) {
      if (car.shattered) {
        return;
      }

      car.forceHeld = isHeld;
      car.waiting = isHeld;
      car.forceVelocity.set(0, 0, 0);
      car.forcePeakY = Math.max(car.forcePeakY, car.root.position.y);

      if (holdPosition) {
        car.root.position.copy(holdPosition);
        keepOutOfBuildings(car.root.position, car.route.length * 0.32);
      }
    },
    applyForceImpulse(velocity: THREE.Vector3) {
      if (car.shattered) {
        return;
      }

      car.forceHeld = false;
      car.waiting = true;
      car.forceVelocity.copy(velocity);
      car.forcePeakY = Math.max(car.forcePeakY, car.root.position.y);
    },
  };
}

function updateForceMotion(
  car: TrafficCar,
  deltaSeconds: number,
  scene: THREE.Scene,
  debrisPieces: DebrisPiece[],
  onShatter?: () => void,
): void {
  car.waiting = true;
  const impactVelocity = car.forceVelocity.clone();
  car.forceVelocity.y -= 24 * deltaSeconds;
  car.root.position.addScaledVector(car.forceVelocity, deltaSeconds);
  const hitBuilding = keepOutOfBuildings(car.root.position, car.route.length * 0.32);
  car.forcePeakY = Math.max(car.forcePeakY, car.root.position.y);

  if (hitBuilding && getHorizontalSpeed(impactVelocity) > 16) {
    shatterCar(car, scene, debrisPieces, impactVelocity, onShatter);
    return;
  }

  car.forceVelocity.x *= Math.exp(-deltaSeconds * 0.55);
  car.forceVelocity.z *= Math.exp(-deltaSeconds * 0.55);
  car.root.position.x = THREE.MathUtils.clamp(car.root.position.x, cityBounds.minX, cityBounds.maxX);
  car.root.position.z = THREE.MathUtils.clamp(car.root.position.z, cityBounds.minZ, cityBounds.maxZ);

  if (car.root.position.y <= 0.2) {
    car.root.position.y = 0.2;
    if (car.forcePeakY > 22 || impactVelocity.y < -22) {
      shatterCar(car, scene, debrisPieces, impactVelocity, onShatter);
      return;
    }

    car.forceVelocity.set(0, 0, 0);
    car.forcePeakY = 0.2;
    car.waiting = false;
  }
}

function shatterCar(
  car: TrafficCar,
  scene: THREE.Scene,
  debrisPieces: DebrisPiece[],
  impactVelocity: THREE.Vector3,
  onShatter?: () => void,
): void {
  if (car.shattered) {
    return;
  }

  car.shattered = true;
  car.forceHeld = false;
  car.forceVelocity.set(0, 0, 0);
  car.waiting = true;
  car.respawnTime = 7;
  car.root.visible = false;
  debrisPieces.push(...createDebrisFromObject(scene, car.root, impactVelocity));
  onShatter?.();
}

function updateCarRespawn(car: TrafficCar, deltaSeconds: number): void {
  car.respawnTime -= deltaSeconds;

  if (car.respawnTime > 0) {
    return;
  }

  const firstPoint = car.route.points[0];
  car.root.position.set(firstPoint.x, 0.2, firstPoint.z);
  faceNextPoint(car.root, firstPoint, car.route.points[1]);
  car.targetIndex = 1;
  car.waiting = false;
  car.forceHeld = false;
  car.forceVelocity.set(0, 0, 0);
  car.forcePeakY = 0.2;
  car.shattered = false;
  car.root.visible = true;
}

function getHorizontalSpeed(velocity: THREE.Vector3): number {
  return Math.hypot(velocity.x, velocity.z);
}

function getTrafficCollider(
  car: TrafficCar,
  override?: { x: number; z: number; yaw: number },
): TrafficCollider {
  return {
    x: override?.x ?? car.root.position.x,
    z: override?.z ?? car.root.position.z,
    yaw: override?.yaw ?? car.root.rotation.y,
    halfLength: car.route.length * 0.5 + 1.4,
    halfWidth: car.route.length * 0.23 + 0.45,
  };
}

function trafficCollidersOverlap(a: TrafficCollider, b: TrafficCollider): boolean {
  const axes = [getForwardAxis(a.yaw), getRightAxis(a.yaw), getForwardAxis(b.yaw), getRightAxis(b.yaw)];

  return axes.every((axis) => {
    const centerDistance = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
    return centerDistance < getProjectionRadius(a, axis) + getProjectionRadius(b, axis);
  });
}

function getProjectionRadius(collider: TrafficCollider, axis: { x: number; z: number }): number {
  const forward = getForwardAxis(collider.yaw);
  const right = getRightAxis(collider.yaw);
  return (
    Math.abs(axis.x * forward.x + axis.z * forward.z) * collider.halfLength +
    Math.abs(axis.x * right.x + axis.z * right.z) * collider.halfWidth
  );
}

function getForwardAxis(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

function getRightAxis(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

function faceNextPoint(root: THREE.Group, current: { x: number; z: number }, next: { x: number; z: number }): void {
  root.rotation.y = getHeadingYaw(next.x - current.x, next.z - current.z);
}

function getHeadingYaw(directionX: number, directionZ: number): number {
  return Math.atan2(directionX, directionZ);
}

function collectWheels(root: THREE.Object3D): THREE.Object3D[] {
  const wheels: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (/wheel-(front|back)-(left|right)/i.test(object.name)) {
      wheels.push(object);
    }
  });
  return wheels;
}

function spinWheels(wheels: THREE.Object3D[], distance: number): void {
  wheels.forEach((wheel) => {
    wheel.rotation.x -= distance * 1.8;
  });
}

function normalizeCarModel(source: THREE.Group, targetLength: number): THREE.Group {
  const model = source.clone(true);
  const wrapper = new THREE.Group();
  wrapper.name = "traffic-car";

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = targetLength / Math.max(size.x, size.z, 0.001);

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  wrapper.add(model);
  return wrapper;
}
