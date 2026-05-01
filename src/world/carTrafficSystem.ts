import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface TrafficRoute {
  assetId: string;
  speed: number;
  scale: number;
  points: Array<{ x: number; z: number }>;
}

interface TrafficCar {
  root: THREE.Group;
  route: TrafficRoute;
  targetIndex: number;
}

export interface CarTrafficSystem {
  update(deltaSeconds: number): void;
  dispose(): void;
}

const trafficRoutes: TrafficRoute[] = [
  {
    assetId: "sedan",
    speed: 9.5,
    scale: 3.8,
    points: [
      { x: -96, z: -8 },
      { x: -38, z: -8 },
      { x: 8, z: -8 },
      { x: 54, z: -8 },
      { x: 96, z: -8 },
    ],
  },
  {
    assetId: "taxi",
    speed: 8.8,
    scale: 3.75,
    points: [
      { x: 96, z: 8 },
      { x: 54, z: 8 },
      { x: 8, z: 8 },
      { x: -38, z: 8 },
      { x: -96, z: 8 },
    ],
  },
  {
    assetId: "van",
    speed: 7.4,
    scale: 3.9,
    points: [
      { x: -8, z: 96 },
      { x: -8, z: 54 },
      { x: -8, z: 8 },
      { x: -8, z: -38 },
      { x: -8, z: -96 },
    ],
  },
  {
    assetId: "suv",
    speed: 8.1,
    scale: 3.75,
    points: [
      { x: 8, z: -96 },
      { x: 8, z: -38 },
      { x: 8, z: 8 },
      { x: 8, z: 54 },
      { x: 8, z: 96 },
    ],
  },
  {
    assetId: "delivery",
    speed: 6.5,
    scale: 4.15,
    points: [
      { x: -96, z: 54 },
      { x: -46, z: 54 },
      { x: 0, z: 54 },
      { x: 46, z: 54 },
      { x: 96, z: 54 },
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
      const root = normalizeCarModel(gltf.scene, route.scale);
      const firstPoint = route.points[0];
      root.position.set(firstPoint.x, 0.2, firstPoint.z);
      faceNextPoint(root, firstPoint, route.points[1]);
      scene.add(root);

      return {
        root,
        route,
        targetIndex: 1,
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
  car.root.rotation.y = Math.atan2(directionX, directionZ) + Math.PI * 0.5;
}

function faceNextPoint(root: THREE.Group, current: { x: number; z: number }, next: { x: number; z: number }): void {
  root.rotation.y = Math.atan2(next.x - current.x, next.z - current.z) + Math.PI * 0.5;
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
