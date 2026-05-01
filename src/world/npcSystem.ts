import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildingColliders, cityBounds, type ColliderRect } from "./cityLayout";

type NpcState = "walking" | "pausing" | "lookingAround";

interface WalkNode {
  id: string;
  x: number;
  z: number;
  neighbors: string[];
}

interface NpcConfig {
  characterId: string;
  startNode: string;
  speed: number;
  seed: number;
}

interface NpcWalker {
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  idleAction?: THREE.AnimationAction;
  walkAction?: THREE.AnimationAction;
  currentAction?: THREE.AnimationAction;
  config: NpcConfig;
  state: NpcState;
  stateTime: number;
  currentNode: string;
  targetNode: string;
  previousNode?: string;
  seed: number;
  baseRotation: number;
}

export interface NpcSystem {
  update(deltaSeconds: number): void;
  dispose(): void;
}

const npcRadius = 0.9;
const walkGraph = createWalkGraph();
const npcConfigs: NpcConfig[] = [
  { characterId: "b", startNode: "-46:92", speed: 2.45, seed: 11 },
  { characterId: "d", startNode: "46:92", speed: 2.1, seed: 23 },
  { characterId: "h", startNode: "-92:0", speed: 2.35, seed: 37 },
  { characterId: "n", startNode: "-46:-92", speed: 1.95, seed: 41 },
  { characterId: "q", startNode: "0:46", speed: 2.7, seed: 53 },
];

const npcTextureMap: Record<string, string> = {
  "texture-b.png": "doku-a.png",
  "texture-d.png": "doku-b.png",
  "texture-h.png": "doku-c.png",
  "texture-n.png": "doku-e.png",
  "texture-q.png": "doku-f.png",
};

export async function createNpcSystem(scene: THREE.Scene): Promise<NpcSystem> {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) => {
    const match = url.match(/Textures\/(texture-[a-z]\.png)$/i);
    const textureFile = match ? npcTextureMap[match[1]] : undefined;
    return textureFile ? `/assets/npcs/Textures/${textureFile}` : url;
  });

  const loader = new GLTFLoader(loadingManager);
  const walkers = await Promise.all(
    npcConfigs.map(async (config) => {
      const gltf = await loader.loadAsync(`/assets/npcs/character-${config.characterId}.glb`);
      const root = normalizeNpcModel(gltf.scene);
      const startNode = getNode(config.startNode);
      const initialChoice = chooseNextNode(config.startNode, undefined, config.seed);
      root.position.set(startNode.x, 0.18, startNode.z);

      const mixer = new THREE.AnimationMixer(root);
      const idleClip = THREE.AnimationClip.findByName(gltf.animations, "idle");
      const walkClip = THREE.AnimationClip.findByName(gltf.animations, "walk");
      const idleAction = idleClip ? mixer.clipAction(idleClip) : undefined;
      const walkAction = walkClip ? mixer.clipAction(walkClip) : undefined;
      idleAction?.setEffectiveTimeScale(0.95 + random01(config.seed) * 0.15).play();
      walkAction?.setEffectiveTimeScale(0.72 + config.speed / 12);

      scene.add(root);

      return {
        root,
        mixer,
        idleAction,
        walkAction,
        currentAction: idleAction,
        config,
        state: "pausing" as NpcState,
        stateTime: 0.7 + (config.seed % 4) * 0.35,
        currentNode: config.startNode,
        targetNode: initialChoice.nodeId,
        seed: initialChoice.seed,
        baseRotation: 0,
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

  if (walker.state === "pausing") {
    updatePause(walker, deltaSeconds);
    return;
  }

  if (walker.state === "lookingAround") {
    updateLookAround(walker, deltaSeconds);
    return;
  }

  updateWalking(walker, deltaSeconds);
}

function updateWalking(walker: NpcWalker, deltaSeconds: number): void {
  setNpcAnimation(walker, "walk");
  const target = getNode(walker.targetNode);
  const dx = target.x - walker.root.position.x;
  const dz = target.z - walker.root.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance < 0.4) {
    arriveAtNode(walker);
    return;
  }

  const step = Math.min(distance, walker.config.speed * deltaSeconds);
  const directionX = dx / distance;
  const directionZ = dz / distance;
  const nextX = walker.root.position.x + directionX * step;
  const nextZ = walker.root.position.z + directionZ * step;

  if (intersectsAnyCollider(nextX, nextZ) || !isSafeSegment(walker.root.position.x, walker.root.position.z, nextX, nextZ)) {
    chooseSafeDetour(walker);
    return;
  }

  walker.root.position.x = nextX;
  walker.root.position.z = nextZ;
  walker.root.rotation.y = Math.atan2(directionX, directionZ) + Math.PI;
}

function updatePause(walker: NpcWalker, deltaSeconds: number): void {
  setNpcAnimation(walker, "idle");
  walker.stateTime -= deltaSeconds;

  if (walker.stateTime > 0) {
    return;
  }

  walker.seed = nextSeed(walker.seed);
  if ((walker.seed % 100) < 32) {
    walker.state = "lookingAround";
    walker.stateTime = 0.9 + random01(walker.seed) * 1.4;
    walker.baseRotation = walker.root.rotation.y;
    return;
  }

  walker.state = "walking";
}

function updateLookAround(walker: NpcWalker, deltaSeconds: number): void {
  setNpcAnimation(walker, "idle");
  walker.stateTime -= deltaSeconds;
  walker.root.rotation.y = walker.baseRotation + Math.sin(walker.stateTime * 4.2) * 0.42;

  if (walker.stateTime <= 0) {
    walker.root.rotation.y = walker.baseRotation;
    walker.state = "walking";
  }
}

function arriveAtNode(walker: NpcWalker): void {
  const target = getNode(walker.targetNode);
  walker.root.position.set(target.x, 0.18, target.z);
  walker.previousNode = walker.currentNode;
  walker.currentNode = walker.targetNode;
  const nextChoice = chooseNextNode(walker.currentNode, walker.previousNode, walker.seed);
  walker.targetNode = nextChoice.nodeId;
  walker.seed = nextChoice.seed;
  walker.state = "pausing";
  walker.stateTime = 1.5 + random01(walker.seed) * 3.5;
}

function chooseSafeDetour(walker: NpcWalker): void {
  const nextChoice = chooseNextNode(walker.currentNode, walker.targetNode, walker.seed + 17);
  walker.targetNode = nextChoice.nodeId;
  walker.seed = nextChoice.seed;
  walker.state = "pausing";
  walker.stateTime = 0.8 + random01(walker.seed) * 1.2;
}

function createWalkGraph(): Map<string, WalkNode> {
  const graph = new Map<string, WalkNode>();
  const coordinates = [-92, -46, 0, 46, 92];

  coordinates.forEach((z) => {
    coordinates.forEach((x) => {
      if (x >= cityBounds.minX && x <= cityBounds.maxX && z >= cityBounds.minZ && z <= cityBounds.maxZ && !intersectsAnyCollider(x, z)) {
        const id = createNodeId(x, z);
        graph.set(id, { id, x, z, neighbors: [] });
      }
    });
  });

  graph.forEach((node) => {
    coordinates.forEach((candidateX) => {
      const candidateId = createNodeId(candidateX, node.z);
      if (candidateX !== node.x && graph.has(candidateId) && isAdjacentCoordinate(node.x, candidateX) && isSafeSegment(node.x, node.z, candidateX, node.z)) {
        node.neighbors.push(candidateId);
      }
    });

    coordinates.forEach((candidateZ) => {
      const candidateId = createNodeId(node.x, candidateZ);
      if (candidateZ !== node.z && graph.has(candidateId) && isAdjacentCoordinate(node.z, candidateZ) && isSafeSegment(node.x, node.z, node.x, candidateZ)) {
        node.neighbors.push(candidateId);
      }
    });
  });

  return graph;
}

function createNodeId(x: number, z: number): string {
  return `${x}:${z}`;
}

function isAdjacentCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) === 46;
}

function getNode(nodeId: string): WalkNode {
  const node = walkGraph.get(nodeId);

  if (!node) {
    throw new Error(`Missing NPC walk node: ${nodeId}`);
  }

  return node;
}

function chooseNextNode(currentNodeId: string, previousNodeId: string | undefined, seed: number): { nodeId: string; seed: number } {
  const currentNode = getNode(currentNodeId);
  const options = currentNode.neighbors.filter((nodeId) => nodeId !== previousNodeId);
  const candidates = options.length > 0 ? options : currentNode.neighbors;

  if (candidates.length === 0) {
    return { nodeId: currentNodeId, seed: nextSeed(seed) };
  }

  const next = nextSeed(seed);
  const nodeId = candidates[Math.floor(random01(next) * candidates.length) % candidates.length];
  return { nodeId, seed: next };
}

function setNpcAnimation(walker: NpcWalker, animation: "idle" | "walk"): void {
  const nextAction = animation === "walk" ? walker.walkAction : walker.idleAction;

  if (!nextAction || nextAction === walker.currentAction) {
    return;
  }

  nextAction.enabled = true;
  nextAction.paused = false;
  nextAction.reset().fadeIn(0.18).play();
  walker.currentAction?.fadeOut(0.18);
  walker.currentAction = nextAction;
}

function intersectsAnyCollider(x: number, z: number): boolean {
  return buildingColliders.some((collider) => pointIntersectsCollider(x, z, collider));
}

function pointIntersectsCollider(x: number, z: number, collider: ColliderRect): boolean {
  return x > collider.minX - npcRadius && x < collider.maxX + npcRadius && z > collider.minZ - npcRadius && z < collider.maxZ + npcRadius;
}

function isSafeSegment(startX: number, startZ: number, endX: number, endZ: number): boolean {
  return !buildingColliders.some((collider) => segmentIntersectsCollider(startX, startZ, endX, endZ, collider));
}

function segmentIntersectsCollider(startX: number, startZ: number, endX: number, endZ: number, collider: ColliderRect): boolean {
  const minX = collider.minX - npcRadius;
  const maxX = collider.maxX + npcRadius;
  const minZ = collider.minZ - npcRadius;
  const maxZ = collider.maxZ + npcRadius;
  const dx = endX - startX;
  const dz = endZ - startZ;
  let near = 0;
  let far = 1;

  const clip = (distance: number, edge: number): boolean => {
    if (distance === 0) {
      return edge >= 0;
    }

    const value = edge / distance;
    if (distance < 0) {
      if (value > far) {
        return false;
      }
      if (value > near) {
        near = value;
      }
      return true;
    }

    if (value < near) {
      return false;
    }
    if (value < far) {
      far = value;
    }
    return true;
  };

  return clip(-dx, startX - minX) && clip(dx, maxX - startX) && clip(-dz, startZ - minZ) && clip(dz, maxZ - startZ);
}

function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function random01(seed: number): number {
  return seed / 0xffffffff;
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
