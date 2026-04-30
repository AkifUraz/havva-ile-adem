import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "./assetCatalog";
import { assetCatalog, assetsById } from "./assetCatalog";
import { blockSize, cityBlocks, roadWidth } from "./cityLayout";

interface LoadedAsset {
  entry: AssetCatalogEntry;
  scene: THREE.Group;
}

const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
  if (url.endsWith("Textures/colormap.png")) {
    return "/assets/city/Textures/colormap.png";
  }

  return url;
});

const loader = new GLTFLoader(loadingManager);
const maxAnisotropyFallback = 4;

export async function createCity(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Promise<THREE.Group> {
  const city = new THREE.Group();
  city.name = "city-root";

  const loadedAssets = await loadRequiredAssets();
  const loadedById = new Map(loadedAssets.map((asset) => [asset.entry.id, asset]));

  createGround(city);
  createRoadGrid(city);
  createCityBlocks(city, loadedById);
  createSkylineRing(city, loadedById);
  tuneCityMaterials(city, renderer.capabilities.getMaxAnisotropy() || maxAnisotropyFallback);

  scene.add(city);
  return city;
}

async function loadRequiredAssets(): Promise<LoadedAsset[]> {
  const neededIds = new Set<string>();

  cityBlocks.forEach((block) => {
    neededIds.add(block.assetId);
    block.detailIds.forEach((detailId) => neededIds.add(detailId));
  });

  assetCatalog
    .filter((asset) => asset.category === "lowDetail")
    .slice(0, 10)
    .forEach((asset) => neededIds.add(asset.id));

  return Promise.all(
    Array.from(neededIds).map(async (assetId) => {
      const entry = assetsById.get(assetId);

      if (!entry) {
        throw new Error(`Missing city asset: ${assetId}`);
      }

      const gltf = await loader.loadAsync(entry.url);
      return { entry, scene: gltf.scene };
    }),
  );
}

function createGround(city: THREE.Group): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({
      color: 0x20252a,
      roughness: 0.92,
      metalness: 0.02,
    }),
  );
  ground.name = "asphalt-ground";
  ground.rotation.x = -Math.PI * 0.5;
  ground.receiveShadow = true;
  city.add(ground);
}

function createRoadGrid(city: THREE.Group): void {
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.88 });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf1d36c });
  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x777a76, roughness: 0.82 });
  const centers = [-92, -46, 0, 46, 92];

  centers.forEach((x) => {
    const road = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, 0.08, 224), roadMaterial);
    road.position.set(x, 0.03, 0);
    road.receiveShadow = true;
    city.add(road);

    const line = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.09, 212), lineMaterial);
    line.position.set(x, 0.08, 0);
    city.add(line);
  });

  centers.forEach((z) => {
    const road = new THREE.Mesh(new THREE.BoxGeometry(224, 0.08, roadWidth), roadMaterial);
    road.position.set(0, 0.04, z);
    road.receiveShadow = true;
    city.add(road);

    const line = new THREE.Mesh(new THREE.BoxGeometry(212, 0.09, 0.35), lineMaterial);
    line.position.set(0, 0.09, z);
    city.add(line);
  });

  cityBlocks.forEach((block) => {
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(blockSize + 5, 0.16, blockSize + 5), sidewalkMaterial);
    sidewalk.position.set(block.x, 0.11, block.z);
    sidewalk.receiveShadow = true;
    city.add(sidewalk);
  });
}

function createCityBlocks(city: THREE.Group, loadedById: Map<string, LoadedAsset>): void {
  cityBlocks.forEach((block) => {
    const loaded = loadedById.get(block.assetId);

    if (!loaded) {
      return;
    }

    const isSkyscraper = loaded.entry.category === "skyscraper";
    const targetHeight = isSkyscraper ? 42 * block.scale : 26 * block.scale;
    const building = instantiateAsset(loaded.scene, blockSize * 0.78, targetHeight);
    building.name = `city-block-${block.assetId}`;
    building.position.set(block.x, 0.18, block.z);
    building.rotation.y = block.rotationY;
    city.add(building);

    block.detailIds.forEach((detailId, index) => {
      const detail = loadedById.get(detailId);

      if (!detail) {
        return;
      }

      const prop = instantiateAsset(detail.scene, index === 0 ? 8 : 5, index === 0 ? 4 : 3);
      const side = index % 2 === 0 ? -1 : 1;
      prop.position.set(block.x + side * 10.8, 0.2, block.z + (index === 0 ? -13.5 : 13.5));
      prop.rotation.y = index === 0 ? block.rotationY : block.rotationY + Math.PI;
      city.add(prop);
    });
  });
}

function createSkylineRing(city: THREE.Group, loadedById: Map<string, LoadedAsset>): void {
  const lowDetailAssets = Array.from(loadedById.values()).filter((asset) => asset.entry.category === "lowDetail");

  lowDetailAssets.forEach((loaded, index) => {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const x = -92 + column * 46;
    const z = row === 0 ? -118 : 118;
    const building = instantiateAsset(loaded.scene, 20, 18 + (index % 3) * 4);
    building.name = `background-${loaded.entry.id}`;
    building.position.set(x, 0.1, z);
    building.rotation.y = index % 2 === 0 ? 0 : Math.PI * 0.5;
    city.add(building);
  });
}

function instantiateAsset(source: THREE.Group, targetFootprint: number, targetHeight: number): THREE.Group {
  const model = source.clone(true);
  const wrapper = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const safeWidth = Math.max(size.x, 0.001);
  const safeDepth = Math.max(size.z, 0.001);
  const safeHeight = Math.max(size.y, 0.001);
  const scale = Math.min(targetFootprint / safeWidth, targetFootprint / safeDepth, targetHeight / safeHeight);

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
