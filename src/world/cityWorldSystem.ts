import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "./assetCatalog";
import { assetCatalog } from "./assetCatalog";
import { resolveAssetUrl } from "./assetResolver";
import { blockSize, removeBuildingCollider, replaceBuildingColliders, roadWidth, type ColliderRect } from "./cityLayout";
import { keepOutOfBuildings } from "./collisionUtils";
import type { FeedbackSystem } from "./feedbackSystem";
import type { ForceTarget } from "./forceTarget";
import type { LaserHitResult, LaserTarget } from "./laserTarget";

interface LoadedAsset {
  entry: AssetCatalogEntry;
  scene: THREE.Group;
}

interface CityChunk {
  key: string;
  x: number;
  z: number;
  root: THREE.Group;
  buildings: DestructibleBuilding[];
}

interface DestructibleBuilding {
  id: string;
  root: THREE.Group;
  collider: ColliderRect;
  center: THREE.Vector3;
  footprint: number;
  height: number;
  health: number;
  destroyed: boolean;
  chunkKey: string;
}

interface BuildingPiece {
  id: string;
  object: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  radius: number;
  forceHeld: boolean;
  forceVelocity: THREE.Vector3;
  age: number;
  lifetime: number;
  chunkKey: string;
}

export interface PieceImpact {
  x: number;
  z: number;
  radius: number;
  velocity: THREE.Vector3;
}

export interface CityWorldSystem {
  update(playerPosition: THREE.Vector3, deltaSeconds: number): void;
  getBuildingColliders(): ColliderRect[];
  getLaserTargets(): LaserTarget[];
  getForceTargets(): ForceTarget[];
  consumePieceImpacts(): PieceImpact[];
  dispose(): void;
}

const chunkSize = 184;
const localBlockCenters = [-69, -23, 23, 69];
const roadCenters = [-92, -46, 0, 46, 92];
const maxBuildingPieces = 96;
const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => (url.endsWith("Textures/colormap.png") ? resolveAssetUrl("/assets/city/Textures/colormap.png") : url));

const loader = new GLTFLoader(loadingManager);
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.88 });
const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf1d36c });
const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x777a76, roughness: 0.82 });
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.92, metalness: 0.02 });
const pieceMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xb9c1ca, roughness: 0.86 }),
  new THREE.MeshStandardMaterial({ color: 0x4a5361, roughness: 0.82 }),
  new THREE.MeshStandardMaterial({ color: 0x2f3540, roughness: 0.9 }),
];

export async function createCityWorldSystem(scene: THREE.Scene, renderer: THREE.WebGLRenderer, feedback: FeedbackSystem): Promise<CityWorldSystem> {
  const cityRoot = new THREE.Group();
  cityRoot.name = "streaming-city-world";
  scene.add(cityRoot);

  const loadedAssets = await loadCityAssets();
  const chunks = new Map<string, CityChunk>();
  const buildingPieces: BuildingPiece[] = [];
  const pieceImpacts: PieceImpact[] = [];
  let activeChunkX = Number.NaN;
  let activeChunkZ = Number.NaN;

  const system: CityWorldSystem = {
    update(playerPosition: THREE.Vector3, deltaSeconds: number) {
      const nextChunkX = Math.floor((playerPosition.x + chunkSize * 0.5) / chunkSize);
      const nextChunkZ = Math.floor((playerPosition.z + chunkSize * 0.5) / chunkSize);

      if (nextChunkX !== activeChunkX || nextChunkZ !== activeChunkZ) {
        activeChunkX = nextChunkX;
        activeChunkZ = nextChunkZ;
        refreshChunks(cityRoot, chunks, loadedAssets, activeChunkX, activeChunkZ, buildingPieces);
        syncBuildingColliders(chunks);
      }

      updateBuildingPieces(scene, buildingPieces, pieceImpacts, deltaSeconds);
      trimBuildingPieces(scene, buildingPieces);
    },
    getBuildingColliders() {
      const colliders: ColliderRect[] = [];
      chunks.forEach((chunk) => {
        chunk.buildings.forEach((building) => {
          if (!building.destroyed) {
            colliders.push(building.collider);
          }
        });
      });
      return colliders;
    },
    getLaserTargets() {
      const targets: LaserTarget[] = [];
      chunks.forEach((chunk) => {
        chunk.buildings.forEach((building) => {
          if (building.destroyed) {
            return;
          }

          targets.push(createLaserTarget(scene, feedback, building, buildingPieces));
        });
      });
      return targets;
    },
    getForceTargets() {
      return buildingPieces.map((piece) => createBuildingPieceForceTarget(piece));
    },
    consumePieceImpacts() {
      return pieceImpacts.splice(0, pieceImpacts.length);
    },
    dispose() {
      chunks.forEach((chunk) => cityRoot.remove(chunk.root));
      chunks.clear();
      buildingPieces.forEach((piece) => scene.remove(piece.object));
      buildingPieces.length = 0;
      replaceBuildingColliders([]);
      scene.remove(cityRoot);
    },
  };

  system.update(new THREE.Vector3(), 0);
  tuneCityMaterials(cityRoot, renderer.capabilities.getMaxAnisotropy() || 4);
  return system;
}

async function loadCityAssets(): Promise<LoadedAsset[]> {
  const buildableAssets = assetCatalog.filter((asset) => asset.category === "building" || asset.category === "skyscraper" || asset.category === "lowDetail");
  const uniqueAssets = new Map(buildableAssets.map((asset) => [asset.id, asset]));

  return Promise.all(
    Array.from(uniqueAssets.values()).map(async (entry) => {
      const gltf = await loader.loadAsync(resolveAssetUrl(entry.url));
      return { entry, scene: gltf.scene };
    }),
  );
}

function refreshChunks(root: THREE.Group, chunks: Map<string, CityChunk>, loadedAssets: LoadedAsset[], centerX: number, centerZ: number, pieces: BuildingPiece[]): void {
  const neededKeys = new Set<string>();

  for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      const key = createChunkKey(x, z);
      neededKeys.add(key);

      if (!chunks.has(key)) {
        const chunk = createChunk(x, z, loadedAssets);
        chunks.set(key, chunk);
        root.add(chunk.root);
      }
    }
  }

  chunks.forEach((chunk, key) => {
    if (neededKeys.has(key)) {
      return;
    }

    root.remove(chunk.root);
    chunks.delete(key);
    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      if (pieces[index].chunkKey === key) {
        pieces[index].object.removeFromParent();
        pieces.splice(index, 1);
      }
    }
  });
}

function createChunk(chunkX: number, chunkZ: number, loadedAssets: LoadedAsset[]): CityChunk {
  const root = new THREE.Group();
  const key = createChunkKey(chunkX, chunkZ);
  const originX = chunkX * chunkSize;
  const originZ = chunkZ * chunkSize;
  root.name = `city-chunk-${key}`;
  root.position.set(originX, 0, originZ);

  createGround(root);
  createRoadGrid(root);
  const buildings = createBuildings(root, key, chunkX, chunkZ, loadedAssets);
  tuneCityMaterials(root, 4);

  return { key, x: chunkX, z: chunkZ, root, buildings };
}

function createGround(root: THREE.Group): void {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(chunkSize, chunkSize), groundMaterial);
  ground.name = "chunk-ground";
  ground.rotation.x = -Math.PI * 0.5;
  ground.receiveShadow = true;
  root.add(ground);
}

function createRoadGrid(root: THREE.Group): void {
  roadCenters.forEach((x) => {
    const road = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, 0.08, chunkSize), roadMaterial);
    road.position.set(x, 0.03, 0);
    road.receiveShadow = true;
    root.add(road);

    const line = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.09, chunkSize - 12), lineMaterial);
    line.position.set(x, 0.08, 0);
    root.add(line);
  });

  roadCenters.forEach((z) => {
    const road = new THREE.Mesh(new THREE.BoxGeometry(chunkSize, 0.08, roadWidth), roadMaterial);
    road.position.set(0, 0.04, z);
    road.receiveShadow = true;
    root.add(road);

    const line = new THREE.Mesh(new THREE.BoxGeometry(chunkSize - 12, 0.09, 0.35), lineMaterial);
    line.position.set(0, 0.09, z);
    root.add(line);
  });

  localBlockCenters.forEach((z) => {
    localBlockCenters.forEach((x) => {
      const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(blockSize + 7, 0.16, blockSize + 7), sidewalkMaterial);
      sidewalk.position.set(x, 0.11, z);
      sidewalk.receiveShadow = true;
      root.add(sidewalk);
    });
  });
}

function createBuildings(root: THREE.Group, chunkKey: string, chunkX: number, chunkZ: number, loadedAssets: LoadedAsset[]): DestructibleBuilding[] {
  const buildings: DestructibleBuilding[] = [];

  localBlockCenters.forEach((localZ, row) => {
    localBlockCenters.forEach((localX, column) => {
      const seed = hash(`${chunkKey}:${row}:${column}`);
      const loaded = chooseLoadedAsset(loadedAssets, seed);
      const isTall = loaded.entry.category === "skyscraper" || seed % 5 === 0;
      const footprint = isTall ? 34 : 32;
      const height = isTall ? 62 + (seed % 4) * 7 : 42 + (seed % 5) * 4;
      const building = instantiateAsset(loaded.scene, footprint, height);
      const worldX = chunkX * chunkSize + localX;
      const worldZ = chunkZ * chunkSize + localZ;
      building.name = `destructible-${loaded.entry.id}`;
      building.position.set(localX, 0.18, localZ);
      building.rotation.y = ((seed % 4) * Math.PI) / 2;
      root.add(building);

      buildings.push({
        id: `${chunkKey}:${row}:${column}`,
        root: building,
        collider: {
          minX: worldX - blockSize * 0.54,
          maxX: worldX + blockSize * 0.54,
          minZ: worldZ - blockSize * 0.54,
          maxZ: worldZ + blockSize * 0.54,
          maxY: 0.18 + height,
        },
        center: new THREE.Vector3(worldX, height * 0.5, worldZ),
        footprint,
        height,
        health: 1.15,
        destroyed: false,
        chunkKey,
      });
    });
  });

  return buildings;
}

function chooseLoadedAsset(loadedAssets: LoadedAsset[], seed: number): LoadedAsset {
  const candidates = loadedAssets.filter((asset) => asset.entry.category === "building" || asset.entry.category === "skyscraper");
  return candidates[seed % candidates.length] ?? loadedAssets[seed % loadedAssets.length];
}

function instantiateAsset(source: THREE.Group, targetFootprint: number, targetHeight: number): THREE.Group {
  const model = source.clone(true);
  const wrapper = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = targetFootprint / Math.max(size.x, size.z, 0.001);

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  if (size.y * scale > targetHeight * 1.35) {
    model.scale.y *= targetHeight / (size.y * scale);
  }

  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  wrapper.add(model);
  return wrapper;
}

function createLaserTarget(scene: THREE.Scene, feedback: FeedbackSystem, building: DestructibleBuilding, pieces: BuildingPiece[]): LaserTarget {
  return {
    id: building.id,
    object: building.root,
    position: building.center,
    radius: building.footprint * 0.85,
    applyLaserHit(hitPoint: THREE.Vector3, deltaSeconds: number): LaserHitResult {
      if (building.destroyed) {
        return { isDestroyed: true, feedbackPosition: hitPoint.clone(), shakeAmount: 0 };
      }

      building.health -= deltaSeconds;
      feedback.addLaserSpark(hitPoint);

      if (building.health > 0) {
        return { isDestroyed: false, feedbackPosition: hitPoint.clone(), shakeAmount: 0.03 };
      }

      building.destroyed = true;
      building.root.visible = false;
      building.root.removeFromParent();
      removeBuildingCollider(building.collider);
      createBuildingPieces(scene, building, pieces);
      feedback.addDustBurst(building.center, 1.6);
      return { isDestroyed: true, feedbackPosition: building.center.clone(), shakeAmount: 0.18 };
    },
  };
}

function createBuildingPieces(scene: THREE.Scene, building: DestructibleBuilding, pieces: BuildingPiece[]): void {
  const pieceCount = 3;
  const pieceHeight = building.height / pieceCount;

  for (let index = 0; index < pieceCount; index += 1) {
    const material = pieceMaterials[index % pieceMaterials.length];
    const piece = new THREE.Mesh(new THREE.BoxGeometry(building.footprint * 0.95, pieceHeight * 0.86, building.footprint * 0.95), material);
    piece.name = `building-piece-${building.id}-${index}`;
    piece.position.set(
      building.center.x + (index - 1) * building.footprint * 0.16,
      pieceHeight * index + pieceHeight * 0.5,
      building.center.z + (index % 2 === 0 ? -1 : 1) * building.footprint * 0.1,
    );
    piece.rotation.y = (index - 1) * 0.1;
    piece.castShadow = true;
    piece.receiveShadow = true;
    scene.add(piece);

    pieces.push({
      id: piece.name,
      object: piece,
      velocity: new THREE.Vector3((index - 1) * 4.5, 7 + index * 1.2, (index % 2 === 0 ? -1 : 1) * 3),
      angularVelocity: new THREE.Vector3(0.45 + index * 0.2, 0.35 * (index - 1), 0.28),
      radius: building.footprint * 0.42,
      forceHeld: false,
      forceVelocity: new THREE.Vector3(),
      age: 0,
      lifetime: 15,
      chunkKey: building.chunkKey,
    });
  }
}

function updateBuildingPieces(scene: THREE.Scene, pieces: BuildingPiece[], impacts: PieceImpact[], deltaSeconds: number): void {
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index];
    piece.age += deltaSeconds;

    if (piece.age > piece.lifetime) {
      scene.remove(piece.object);
      pieces.splice(index, 1);
      continue;
    }

    if (piece.forceHeld) {
      continue;
    }

    if (piece.forceVelocity.lengthSq() > 0.01) {
      piece.velocity.copy(piece.forceVelocity);
      piece.forceVelocity.multiplyScalar(Math.exp(-deltaSeconds * 1.8));
    }

    piece.velocity.y -= 18 * deltaSeconds;
    piece.object.position.addScaledVector(piece.velocity, deltaSeconds);
    keepOutOfBuildings(piece.object.position, piece.radius * 0.55);
    piece.object.rotation.x += piece.angularVelocity.x * deltaSeconds;
    piece.object.rotation.y += piece.angularVelocity.y * deltaSeconds;
    piece.object.rotation.z += piece.angularVelocity.z * deltaSeconds;

    if (piece.velocity.lengthSq() > 120) {
      impacts.push({
        x: piece.object.position.x,
        z: piece.object.position.z,
        radius: piece.radius,
        velocity: piece.velocity.clone(),
      });
    }

    if (piece.object.position.y <= 0.18) {
      piece.object.position.y = 0.18;
      piece.velocity.multiplyScalar(0.45);
      piece.velocity.y = Math.max(0, piece.velocity.y) * 0.12;
      piece.angularVelocity.multiplyScalar(0.74);
    }
  }
}

function trimBuildingPieces(scene: THREE.Scene, pieces: BuildingPiece[]): void {
  while (pieces.length > maxBuildingPieces) {
    const piece = pieces.shift();
    if (piece) {
      scene.remove(piece.object);
    }
  }
}

function createBuildingPieceForceTarget(piece: BuildingPiece): ForceTarget {
  return {
    id: piece.id,
    type: "buildingPiece",
    object: piece.object,
    radius: piece.radius,
    isAvailable() {
      return piece.object.parent !== null;
    },
    setForceHeld(isHeld: boolean, holdPosition?: THREE.Vector3) {
      piece.forceHeld = isHeld;
      piece.forceVelocity.set(0, 0, 0);

      if (holdPosition) {
        piece.object.position.copy(holdPosition);
      }
    },
    applyForceImpulse(velocity: THREE.Vector3) {
      piece.forceHeld = false;
      piece.forceVelocity.copy(velocity);
      piece.velocity.copy(velocity);
      piece.age = Math.min(piece.age, piece.lifetime - 4);
    },
  };
}

function syncBuildingColliders(chunks: Map<string, CityChunk>): void {
  const colliders: ColliderRect[] = [];
  chunks.forEach((chunk) => {
    chunk.buildings.forEach((building) => {
      if (!building.destroyed) {
        colliders.push(building.collider);
      }
    });
  });
  replaceBuildingColliders(colliders);
}

function tuneCityMaterials(root: THREE.Object3D, anisotropy: number): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
        material.roughness = Math.max(material.roughness, 0.54);

        if (material.map) {
          material.map.anisotropy = anisotropy;
          material.map.needsUpdate = true;
        }
      }
    });
  });
}

function createChunkKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
