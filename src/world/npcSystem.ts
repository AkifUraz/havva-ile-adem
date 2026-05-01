import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface NpcRoute {
  characterId: string;
  speed: number;
  points: Array<{ x: number; z: number }>;
}

interface NpcWalker {
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  walkAction?: THREE.AnimationAction;
  route: NpcRoute;
  targetIndex: number;
  pauseTime: number;
}

export interface NpcSystem {
  update(deltaSeconds: number): void;
  dispose(): void;
}

const npcRoutes: NpcRoute[] = [
  {
    characterId: "b",
    speed: 3.45,
    points: [
      { x: -9, z: 82 },
      { x: 36, z: 82 },
      { x: 36, z: 48 },
      { x: 82, z: 48 },
      { x: 82, z: 4 },
      { x: 36, z: 4 },
      { x: -9, z: 4 },
    ],
  },
  {
    characterId: "d",
    speed: 3.1,
    points: [
      { x: 54, z: 86 },
      { x: 54, z: 42 },
      { x: 8, z: 42 },
      { x: 8, z: -4 },
      { x: 54, z: -4 },
      { x: 54, z: -48 },
    ],
  },
  {
    characterId: "h",
    speed: 3.3,
    points: [
      { x: -84, z: 8 },
      { x: -42, z: 8 },
      { x: -42, z: 52 },
      { x: 4, z: 52 },
      { x: 4, z: 8 },
      { x: 48, z: 8 },
      { x: 48, z: -38 },
      { x: 4, z: -38 },
      { x: -42, z: -38 },
      { x: -84, z: -38 },
    ],
  },
  {
    characterId: "n",
    speed: 2.95,
    points: [
      { x: -54, z: -84 },
      { x: -54, z: -40 },
      { x: -8, z: -40 },
      { x: -8, z: 6 },
      { x: -54, z: 6 },
      { x: -54, z: 50 },
    ],
  },
  {
    characterId: "q",
    speed: 3.6,
    points: [
      { x: 10, z: 66 },
      { x: -36, z: 66 },
      { x: -36, z: 20 },
      { x: -82, z: 20 },
      { x: -82, z: -24 },
      { x: -36, z: -24 },
      { x: 10, z: -24 },
    ],
  },
];

export async function createNpcSystem(scene: THREE.Scene): Promise<NpcSystem> {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) => {
    const match = url.match(/Textures\/(texture-[a-z]\.png)$/i);
    return match ? `/assets/npcs/Textures/${match[1]}` : url;
  });

  const loader = new GLTFLoader(loadingManager);
  const walkers = await Promise.all(
    npcRoutes.map(async (route) => {
      const gltf = await loader.loadAsync(`/assets/npcs/character-${route.characterId}.glb`);
      const root = normalizeNpcModel(gltf.scene);
      const firstPoint = route.points[0];
      root.position.set(firstPoint.x, 0.18, firstPoint.z);

      const mixer = new THREE.AnimationMixer(root);
      const walkClip = THREE.AnimationClip.findByName(gltf.animations, "walk");
      const walkAction = walkClip ? mixer.clipAction(walkClip) : undefined;
      walkAction?.setEffectiveTimeScale(0.68 + route.speed / 18).play();

      scene.add(root);

      return {
        root,
        mixer,
        walkAction,
        route,
        targetIndex: 1,
        pauseTime: route.characterId.charCodeAt(0) % 3,
      };
    }),
  );

  return {
    update(deltaSeconds: number) {
      walkers.forEach((walker) => updateWalker(walker, deltaSeconds));
    },
    dispose() {
      walkers.forEach((walker) => {
        walker.mixer?.stopAllAction();
        scene.remove(walker.root);
      });
    },
  };
}

function updateWalker(walker: NpcWalker, deltaSeconds: number): void {
  walker.mixer?.update(deltaSeconds);

  if (walker.pauseTime > 0) {
    walker.pauseTime -= deltaSeconds;
    return;
  }

  const target = walker.route.points[walker.targetIndex];
  const dx = target.x - walker.root.position.x;
  const dz = target.z - walker.root.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance < 0.4) {
    walker.targetIndex = (walker.targetIndex + 1) % walker.route.points.length;
    walker.pauseTime = 1.2 + (walker.route.characterId.charCodeAt(0) % 4) * 0.22;
    return;
  }

  const step = Math.min(distance, walker.route.speed * deltaSeconds);
  const directionX = dx / distance;
  const directionZ = dz / distance;

  walker.root.position.x += directionX * step;
  walker.root.position.z += directionZ * step;
  walker.root.rotation.y = Math.atan2(directionX, directionZ) + Math.PI;
}

function normalizeNpcModel(source: THREE.Group): THREE.Group {
  const model = source.clone(true);
  const wrapper = new THREE.Group();
  wrapper.name = "wandering-npc";

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 3.65 / Math.max(size.y, 0.001);

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  model.rotation.y = Math.PI;

  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  wrapper.add(model);
  return wrapper;
}
