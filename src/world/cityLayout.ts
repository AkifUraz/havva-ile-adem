export interface CityBlock {
  x: number;
  z: number;
  assetId: string;
  rotationY: number;
  scale: number;
  detailIds: string[];
}

export interface CityBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ColliderRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const blockSize = 28;
export const roadWidth = 18;
export const blockSpacing = blockSize + roadWidth;
export const cityBounds: CityBounds = {
  minX: -100,
  maxX: 100,
  minZ: -100,
  maxZ: 100,
};

const rotations = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
const centers = [-69, -23, 23, 69];
const assetGrid = [
  ["building-skyscraper-a", "building-g", "building-skyscraper-c", "building-m"],
  ["building-c", "building-skyscraper-b", "building-k", "building-skyscraper-d"],
  ["building-j", "building-f", "building-skyscraper-e", "building-h"],
  ["building-n", "building-i", "building-l", "building-d"],
];
const detailGrid = [
  ["detail-awning-wide", "detail-parasol-a"],
  ["detail-overhang", "detail-awning"],
  ["detail-overhang-wide", "detail-parasol-b"],
  ["detail-awning", "detail-parasol-a"],
];

export const cityBlocks: CityBlock[] = centers.flatMap((z, row) =>
  centers.map((x, column) => ({
    x,
    z,
    assetId: assetGrid[row][column],
    rotationY: rotations[(row + column) % rotations.length],
    scale: row === column || assetGrid[row][column].includes("skyscraper") ? 1.14 : 1,
    detailIds: detailGrid[(row + column) % detailGrid.length],
  })),
);

export const buildingColliders: ColliderRect[] = cityBlocks.map((block) => ({
  minX: block.x - blockSize * 0.34,
  maxX: block.x + blockSize * 0.34,
  minZ: block.z - blockSize * 0.34,
  maxZ: block.z + blockSize * 0.34,
}));
