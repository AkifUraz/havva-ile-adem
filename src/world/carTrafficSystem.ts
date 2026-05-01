import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
}

export interface CarTrafficSystem {
  update(deltaSeconds: number): void;
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
    length: 10.7,
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
    length: 11.5,
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
      };
    }),
  );

  return {
    update(deltaSeconds: number) {
      cars.forEach((car) => updateCar(car, deltaSeconds));
    },
    dispose() {
      cars.forEach((car) => scene.remove(car.root));
    },
  };
}

function updateCar(car: TrafficCar, deltaSeconds: number): void {
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
  car.root.position.x += directionX * step;
  car.root.position.z += directionZ * step;
  car.root.rotation.y = getHeadingYaw(directionX, directionZ);
  spinWheels(car.wheels, step);
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
    if (/wheel/i.test(object.name)) {
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
