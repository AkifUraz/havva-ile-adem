import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildingColliders, cityBounds, type ColliderRect } from "./cityLayout";
import { keepOutOfBuildings } from "./collisionUtils";
import { createDebrisFromObject, disposeDebris, type DebrisPiece, updateDebrisPieces } from "./debrisSystem";
import { resolveAssetUrl } from "./assetResolver";
import type { ForceTarget } from "./forceTarget";
import type { PieceImpact } from "./cityWorldSystem";

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
  leftArm?: THREE.Object3D;
  rightArm?: THREE.Object3D;
  config: NpcConfig;
  state: NpcState;
  stateTime: number;
  currentNode: string;
  targetNode: string;
  previousNode?: string;
  seed: number;
  baseRotation: number;
  forceHeld: boolean;
  forceHeldTime: number;
  forceVelocity: THREE.Vector3;
  forceFlailTime: number;
  forcePeakY: number;
  shattered: boolean;
  respawnTime: number;
}

export interface NpcSystem {
  update(deltaSeconds: number, playerPosition?: THREE.Vector3): void;
  getColliders(): NpcCollider[];
  getForceTargets(): ForceTarget[];
  applyPieceImpacts(impacts: PieceImpact[]): void;
  setPanic(isPanicking: boolean): void;
  dispose(): void;
}

export interface NpcCollider {
  x: number;
  z: number;
  radius: number;
}

const npcRadius = 0.9;
const playerStopRadius = 4.2;
const heldShatterSeconds = 4.8;
const walkGraph = createWalkGraph();
const npcConfigs: NpcConfig[] = [
  { characterId: "b", startNode: "-56:88", speed: 2.45, seed: 11 },
  { characterId: "d", startNode: "36:88", speed: 2.1, seed: 23 },
  { characterId: "h", startNode: "-88:-10", speed: 2.35, seed: 37 },
  { characterId: "n", startNode: "-56:-88", speed: 1.95, seed: 41 },
  { characterId: "q", startNode: "-10:36", speed: 2.7, seed: 53 },
  { characterId: "b", startNode: "88:36", speed: 2.2, seed: 67 },
  { characterId: "d", startNode: "-10:-88", speed: 2.05, seed: 79 },
  { characterId: "h", startNode: "36:88", speed: 2.5, seed: 83 },
  { characterId: "n", startNode: "-88:36", speed: 1.9, seed: 97 },
  { characterId: "q", startNode: "88:-10", speed: 2.35, seed: 109 },
];

const npcTextureMap: Record<string, string> = {
  "texture-b.png": "doku-a.png",
  "texture-d.png": "doku-b.png",
  "texture-h.png": "doku-c.png",
  "texture-n.png": "doku-e.png",
  "texture-q.png": "doku-f.png",
};

export async function createNpcSystem(scene: THREE.Scene, onShatter?: () => void): Promise<NpcSystem> {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) => {
    const match = url.match(/Textures\/(texture-[a-z]\.png)$/i);
    const textureFile = match ? npcTextureMap[match[1]] : undefined;
    return textureFile ? resolveAssetUrl(`/assets/npcs/Textures/${textureFile}`) : url;
  });

  const loader = new GLTFLoader(loadingManager);
  const walkers = await Promise.all(
    npcConfigs.map(async (config) => {
      const gltf = await loader.loadAsync(resolveAssetUrl(`/assets/npcs/character-${config.characterId}.glb`));
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
        leftArm: root.getObjectByName("arm-left"),
        rightArm: root.getObjectByName("arm-right"),
        config,
        state: "pausing" as NpcState,
        stateTime: 0.7 + (config.seed % 4) * 0.35,
        currentNode: config.startNode,
        targetNode: initialChoice.nodeId,
        seed: initialChoice.seed,
        baseRotation: 0,
        forceHeld: false,
        forceHeldTime: 0,
        forceVelocity: new THREE.Vector3(),
        forceFlailTime: random01(config.seed) * Math.PI * 2,
        forcePeakY: 0.18,
        shattered: false,
        respawnTime: 0,
      };
    }),
  );
  const debrisPieces: DebrisPiece[] = [];
  let isPanicking = false;

  return {
    update(deltaSeconds: number, playerPosition?: THREE.Vector3) {
      walkers.forEach((walker) => updateWalker(walker, deltaSeconds, playerPosition, scene, debrisPieces, isPanicking, onShatter));
      updateDebrisPieces(scene, debrisPieces, deltaSeconds);
    },
    getColliders() {
      return walkers
        .filter((walker) => !walker.shattered && !walker.forceHeld && walker.root.position.y < 1.2)
        .map((walker) => ({
          x: walker.root.position.x,
          z: walker.root.position.z,
          radius: npcRadius + 0.25,
        }));
    },
    getForceTargets() {
      return walkers.filter((walker) => !walker.shattered).map((walker, index) => createNpcForceTarget(walker, index));
    },
    applyPieceImpacts(impacts: PieceImpact[]) {
      impacts.forEach((impact) => {
        walkers.forEach((walker) => {
          if (walker.shattered || walker.forceHeld || walker.root.position.y > 2) {
            return;
          }

          const distance = Math.hypot(walker.root.position.x - impact.x, walker.root.position.z - impact.z);
          if (distance < impact.radius + npcRadius + 0.5) {
            shatterNpc(walker, scene, debrisPieces, impact.velocity, onShatter);
          }
        });
      });
    },
    setPanic(nextIsPanicking: boolean) {
      isPanicking = nextIsPanicking;
    },
    dispose() {
      walkers.forEach((walker) => {
        walker.mixer?.stopAllAction();
        scene.remove(walker.root);
      });
      disposeDebris(scene, debrisPieces);
    },
  };
}

function updateWalker(
  walker: NpcWalker,
  deltaSeconds: number,
  playerPosition: THREE.Vector3 | undefined,
  scene: THREE.Scene,
  debrisPieces: DebrisPiece[],
  isPanicking: boolean,
  onShatter?: () => void,
): void {
  if (walker.shattered) {
    updateNpcRespawn(walker, deltaSeconds);
    return;
  }

  walker.mixer?.update(deltaSeconds);

  if (walker.forceHeld) {
    setNpcAnimation(walker, "idle");
    updateForceFlail(walker, deltaSeconds);
    walker.forceHeldTime += deltaSeconds;

    if (walker.forceHeldTime >= heldShatterSeconds && walker.root.position.y > 2.2) {
      const burstVelocity = new THREE.Vector3(
        Math.sin(walker.forceFlailTime) * 10,
        16,
        Math.cos(walker.forceFlailTime * 0.7) * 10,
      );
      shatterNpc(walker, scene, debrisPieces, burstVelocity, onShatter);
    }

    return;
  }

  if (walker.forceVelocity.lengthSq() > 0.01 || walker.root.position.y > 0.19) {
    updateForceMotion(walker, deltaSeconds, scene, debrisPieces, onShatter);
    return;
  }

  if (isPanicking && playerPosition) {
    updatePanicRun(walker, deltaSeconds, playerPosition);
    return;
  }

  if (playerPosition && isNearPlayer(walker.root.position.x, walker.root.position.z, playerPosition)) {
    setNpcAnimation(walker, "idle");
    return;
  }
  if (walker.state === "pausing") {
    updatePause(walker, deltaSeconds);
    return;
  }

  if (walker.state === "lookingAround") {
    updateLookAround(walker, deltaSeconds);
    return;
  }

  updateWalking(walker, deltaSeconds, playerPosition);
}

function updateWalking(walker: NpcWalker, deltaSeconds: number, playerPosition?: THREE.Vector3): void {
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

  if (
    intersectsAnyCollider(nextX, nextZ) ||
    !isSafeSegment(walker.root.position.x, walker.root.position.z, nextX, nextZ) ||
    (playerPosition && isNearPlayer(nextX, nextZ, playerPosition))
  ) {
    if (playerPosition && isNearPlayer(nextX, nextZ, playerPosition)) {
      setNpcAnimation(walker, "idle");
      return;
    }

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

function updatePanicRun(walker: NpcWalker, deltaSeconds: number, playerPosition: THREE.Vector3): void {
  setNpcAnimation(walker, "walk");
  updatePanicArms(walker, deltaSeconds);
  const awayX = walker.root.position.x - playerPosition.x;
  const awayZ = walker.root.position.z - playerPosition.z;
  const distance = Math.max(0.001, Math.hypot(awayX, awayZ));
  const directionX = awayX / distance;
  const directionZ = awayZ / distance;
  const step = Math.min(5.8 * deltaSeconds, 0.42);
  const nextX = THREE.MathUtils.clamp(walker.root.position.x + directionX * step, cityBounds.minX, cityBounds.maxX);
  const nextZ = THREE.MathUtils.clamp(walker.root.position.z + directionZ * step, cityBounds.minZ, cityBounds.maxZ);

  if (!intersectsAnyCollider(nextX, nextZ)) {
    walker.root.position.x = nextX;
    walker.root.position.z = nextZ;
  }

  walker.root.rotation.y = Math.atan2(directionX, directionZ) + Math.PI;
}

function updatePanicArms(walker: NpcWalker, deltaSeconds: number): void {
  if (!walker.leftArm || !walker.rightArm) {
    return;
  }

  walker.forceFlailTime += deltaSeconds * 11;
  const wave = Math.sin(walker.forceFlailTime) * 0.22;
  walker.leftArm.rotation.x = -1.35 + wave;
  walker.leftArm.rotation.y = -0.22;
  walker.leftArm.rotation.z = 0.92 + wave * 0.4;
  walker.rightArm.rotation.x = -1.35 - wave;
  walker.rightArm.rotation.y = 0.22;
  walker.rightArm.rotation.z = -0.92 + wave * 0.4;
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
  const coordinates = [-88, -56, -10, 36, 88];

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
  return Math.abs(a - b) <= 48;
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

function isNearPlayer(x: number, z: number, playerPosition: THREE.Vector3): boolean {
  return Math.hypot(x - playerPosition.x, z - playerPosition.z) < playerStopRadius;
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

function createNpcForceTarget(walker: NpcWalker, index: number): ForceTarget {
  return {
    id: `npc-${index}`,
    type: "npc",
    object: walker.root,
    radius: 2.3,
    isAvailable() {
      return !walker.shattered;
    },
    setForceHeld(isHeld: boolean, holdPosition?: THREE.Vector3) {
      if (walker.shattered) {
        return;
      }

      if (isHeld && !walker.forceHeld) {
        walker.forceHeldTime = 0;
      }

      walker.forceHeld = isHeld;
      walker.forceVelocity.set(0, 0, 0);
      walker.forcePeakY = Math.max(walker.forcePeakY, walker.root.position.y);
      setNpcAnimation(walker, "idle");

      if (holdPosition) {
        walker.root.position.copy(holdPosition);
        keepOutOfBuildings(walker.root.position, npcRadius + 0.7);
      }

      if (!isHeld) {
        walker.forceHeldTime = 0;
      }
    },
    applyForceImpulse(velocity: THREE.Vector3) {
      if (walker.shattered) {
        return;
      }

      walker.forceHeld = false;
      walker.forceHeldTime = 0;
      walker.forceVelocity.copy(velocity);
      walker.forcePeakY = Math.max(walker.forcePeakY, walker.root.position.y);
      walker.state = "pausing";
      walker.stateTime = 1.2;
      setNpcAnimation(walker, "idle");
    },
  };
}

function updateForceMotion(
  walker: NpcWalker,
  deltaSeconds: number,
  scene: THREE.Scene,
  debrisPieces: DebrisPiece[],
  onShatter?: () => void,
): void {
  setNpcAnimation(walker, "idle");
  updateForceFlail(walker, deltaSeconds);
  const impactVelocity = walker.forceVelocity.clone();
  walker.forceVelocity.y -= 22 * deltaSeconds;
  walker.root.position.addScaledVector(walker.forceVelocity, deltaSeconds);
  const hitBuilding = keepOutOfBuildings(walker.root.position, npcRadius + 0.7);
  walker.forcePeakY = Math.max(walker.forcePeakY, walker.root.position.y);

  if (hitBuilding && getHorizontalSpeed(impactVelocity) > 12) {
    shatterNpc(walker, scene, debrisPieces, impactVelocity, onShatter);
    return;
  }

  walker.forceVelocity.x *= Math.exp(-deltaSeconds * 0.65);
  walker.forceVelocity.z *= Math.exp(-deltaSeconds * 0.65);
  walker.root.position.x = THREE.MathUtils.clamp(walker.root.position.x, cityBounds.minX, cityBounds.maxX);
  walker.root.position.z = THREE.MathUtils.clamp(walker.root.position.z, cityBounds.minZ, cityBounds.maxZ);

  if (walker.root.position.y <= 0.18) {
    walker.root.position.y = 0.18;
    if (walker.forcePeakY > 18 || impactVelocity.y < -18) {
      shatterNpc(walker, scene, debrisPieces, impactVelocity, onShatter);
      return;
    }

    walker.forceVelocity.set(0, 0, 0);
    walker.forcePeakY = 0.18;
  }
}

function shatterNpc(
  walker: NpcWalker,
  scene: THREE.Scene,
  debrisPieces: DebrisPiece[],
  impactVelocity: THREE.Vector3,
  onShatter?: () => void,
): void {
  if (walker.shattered) {
    return;
  }

  walker.shattered = true;
  walker.forceHeld = false;
  walker.forceHeldTime = 0;
  walker.forceVelocity.set(0, 0, 0);
  walker.respawnTime = 7;
  walker.mixer?.stopAllAction();
  walker.root.visible = false;
  debrisPieces.push(...createDebrisFromObject(scene, walker.root, impactVelocity));
  onShatter?.();
}

function updateNpcRespawn(walker: NpcWalker, deltaSeconds: number): void {
  walker.respawnTime -= deltaSeconds;

  if (walker.respawnTime > 0) {
    return;
  }

  const startNode = getNode(walker.config.startNode);
  const initialChoice = chooseNextNode(walker.config.startNode, undefined, walker.config.seed);
  walker.root.position.set(startNode.x, 0.18, startNode.z);
  walker.root.rotation.y = 0;
  walker.root.visible = true;
  walker.shattered = false;
  walker.forceHeld = false;
  walker.forceHeldTime = 0;
  walker.forceVelocity.set(0, 0, 0);
  walker.forcePeakY = 0.18;
  walker.currentNode = walker.config.startNode;
  walker.targetNode = initialChoice.nodeId;
  walker.seed = initialChoice.seed;
  walker.state = "pausing";
  walker.stateTime = 0.7 + (walker.config.seed % 4) * 0.35;
  walker.idleAction?.reset().play();
  walker.currentAction = walker.idleAction;
}

function getHorizontalSpeed(velocity: THREE.Vector3): number {
  return Math.hypot(velocity.x, velocity.z);
}

function updateForceFlail(walker: NpcWalker, deltaSeconds: number): void {
  if (!walker.leftArm || !walker.rightArm) {
    return;
  }

  walker.forceFlailTime += deltaSeconds * 8.5;
  const leftWave = Math.sin(walker.forceFlailTime) * 0.32;
  const rightWave = Math.sin(walker.forceFlailTime + Math.PI * 0.72) * 0.32;
  const shieldPulse = Math.sin(walker.forceFlailTime * 1.7) * 0.16;

  walker.leftArm.rotation.x = -1.25 + leftWave;
  walker.leftArm.rotation.y = -0.34 + shieldPulse;
  walker.leftArm.rotation.z = 0.78 + leftWave * 0.45;
  walker.rightArm.rotation.x = -1.25 + rightWave;
  walker.rightArm.rotation.y = 0.34 - shieldPulse;
  walker.rightArm.rotation.z = -0.78 + rightWave * 0.45;
}
