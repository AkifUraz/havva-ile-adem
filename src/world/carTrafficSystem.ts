import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cityBounds } from "./cityLayout";
import { keepOutOfBuildings } from "./collisionUtils";
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
}

export interface TrafficCollider {
  x: number;
  z: number;
  yaw: number;
  halfLength: number;
  halfWidth: number;
}

export interface CarTrafficSystem {
  update(deltaSeconds: number): void;
  getColliders(): TrafficCollider[];
  getForceTargets(): ForceTarget[];
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

export async function createCarTrafficSystem(scene: THREE.Scene): Promise<CarTrafficSystem> {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) => {
    return url.endsWith("Textures/colormap.png") ? "/assets/cars/Textures/colormap.png" : url;
  });

  const loader = new GLTFLoader(loadingManager);
  const cars = await Promise.all(
    trafficRoutes.map(async (route) => {
      const gltf = await loader.loadAsync(`/assets/cars/${route.assetId}.glb`);
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
      };
    }),
  );

  return {
    update(deltaSeconds: number) {
      const colliders = cars.map((car) => getTrafficCollider(car));
      cars.forEach((car, index) => {
        const otherColliders = colliders.filter((_, colliderIndex) => colliderIndex !== index);
        updateCar(car, deltaSeconds, otherColliders);
        colliders[index] = getTrafficCollider(car);
      });
    },
    getColliders() {
      return cars.filter((car) => !car.forceHeld && car.root.position.y < 1.2).map((car) => getTrafficCollider(car));
    },
    getForceTargets() {
      return cars.map((car, index) => createCarForceTarget(car, index));
    },
    dispose() {
      cars.forEach((car) => scene.remove(car.root));
    },
  };
}

function updateCar(car: TrafficCar, deltaSeconds: number, otherColliders: TrafficCollider[]): void {
  if (car.forceHeld) {
    car.waiting = true;
    return;
  }

  if (car.forceVelocity.lengthSq() > 0.01 || car.root.position.y > 0.21) {
    updateForceMotion(car, deltaSeconds);
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

function createCarForceTarget(car: TrafficCar, index: number): ForceTarget {
  return {
    id: `car-${index}`,
    type: "car",
    object: car.root,
    radius: car.route.length * 0.62,
    setForceHeld(isHeld: boolean, holdPosition?: THREE.Vector3) {
      car.forceHeld = isHeld;
      car.waiting = isHeld;
      car.forceVelocity.set(0, 0, 0);

      if (holdPosition) {
        car.root.position.copy(holdPosition);
        keepOutOfBuildings(car.root.position, car.route.length * 0.32);
      }
    },
    applyForceImpulse(velocity: THREE.Vector3) {
      car.forceHeld = false;
      car.waiting = true;
      car.forceVelocity.copy(velocity);
    },
  };
}

function updateForceMotion(car: TrafficCar, deltaSeconds: number): void {
  car.waiting = true;
  car.forceVelocity.y -= 24 * deltaSeconds;
  car.root.position.addScaledVector(car.forceVelocity, deltaSeconds);
  keepOutOfBuildings(car.root.position, car.route.length * 0.32);
  car.forceVelocity.x *= Math.exp(-deltaSeconds * 0.55);
  car.forceVelocity.z *= Math.exp(-deltaSeconds * 0.55);
  car.root.position.x = THREE.MathUtils.clamp(car.root.position.x, cityBounds.minX, cityBounds.maxX);
  car.root.position.z = THREE.MathUtils.clamp(car.root.position.z, cityBounds.minZ, cityBounds.maxZ);

  if (car.root.position.y <= 0.2) {
    car.root.position.y = 0.2;
    car.forceVelocity.set(0, 0, 0);
    car.waiting = false;
  }
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
