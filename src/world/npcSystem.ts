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
  { characterId: "b", speed: 8.5, points: [{ x: -7, z: 72 }, { x: -7, z: 20 }] },
  { characterId: "d", speed: 7.8, points: [{ x: 46, z: 72 }, { x: 46, z: -42 }] },
  { characterId: "h", speed: 8.2, points: [{ x: -54, z: 0 }, { x: 54, z: 0 }] },
  { characterId: "n", speed: 7.4, points: [{ x: -46, z: -36 }, { x: -46, z: 72 }] },
  { characterId: "q", speed: 8.8, points: [{ x: 9, z: 64 }, { x: 9, z: 10 }] },
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
      walkAction?.setEffectiveTimeScale(0.95 + route.speed / 18).play();

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
    walker.pauseTime = 0.6 + (walker.route.characterId.charCodeAt(0) % 4) * 0.18;
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
