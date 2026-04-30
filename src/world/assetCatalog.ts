export type AssetCategory = "building" | "skyscraper" | "lowDetail" | "detail";

export interface AssetCatalogEntry {
  id: string;
  url: string;
  category: AssetCategory;
  weight: number;
}

const assetBase = "/assets/city";

export const assetCatalog: AssetCatalogEntry[] = [
  { id: "building-b", url: `${assetBase}/building-b.glb`, category: "building", weight: 2 },
  { id: "building-c", url: `${assetBase}/building-c.glb`, category: "building", weight: 2 },
  { id: "building-d", url: `${assetBase}/building-d.glb`, category: "building", weight: 2 },
  { id: "building-e", url: `${assetBase}/building-e.glb`, category: "building", weight: 2 },
  { id: "building-f", url: `${assetBase}/building-f.glb`, category: "building", weight: 2 },
  { id: "building-g", url: `${assetBase}/building-g.glb`, category: "building", weight: 2 },
  { id: "building-h", url: `${assetBase}/building-h.glb`, category: "building", weight: 2 },
  { id: "building-i", url: `${assetBase}/building-i.glb`, category: "building", weight: 2 },
  { id: "building-j", url: `${assetBase}/building-j.glb`, category: "building", weight: 2 },
  { id: "building-k", url: `${assetBase}/building-k.glb`, category: "building", weight: 1 },
  { id: "building-l", url: `${assetBase}/building-l.glb`, category: "building", weight: 1 },
  { id: "building-m", url: `${assetBase}/building-m.glb`, category: "building", weight: 1 },
  { id: "building-n", url: `${assetBase}/building-n.glb`, category: "building", weight: 1 },
  { id: "building-skyscraper-a", url: `${assetBase}/building-skyscraper-a.glb`, category: "skyscraper", weight: 2 },
  { id: "building-skyscraper-b", url: `${assetBase}/building-skyscraper-b.glb`, category: "skyscraper", weight: 2 },
  { id: "building-skyscraper-c", url: `${assetBase}/building-skyscraper-c.glb`, category: "skyscraper", weight: 2 },
  { id: "building-skyscraper-d", url: `${assetBase}/building-skyscraper-d.glb`, category: "skyscraper", weight: 2 },
  { id: "building-skyscraper-e", url: `${assetBase}/building-skyscraper-e.glb`, category: "skyscraper", weight: 2 },
  { id: "low-detail-building-a", url: `${assetBase}/low-detail-building-a.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-b", url: `${assetBase}/low-detail-building-b.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-c", url: `${assetBase}/low-detail-building-c.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-d", url: `${assetBase}/low-detail-building-d.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-e", url: `${assetBase}/low-detail-building-e.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-f", url: `${assetBase}/low-detail-building-f.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-g", url: `${assetBase}/low-detail-building-g.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-h", url: `${assetBase}/low-detail-building-h.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-i", url: `${assetBase}/low-detail-building-i.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-j", url: `${assetBase}/low-detail-building-j.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-k", url: `${assetBase}/low-detail-building-k.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-l", url: `${assetBase}/low-detail-building-l.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-m", url: `${assetBase}/low-detail-building-m.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-n", url: `${assetBase}/low-detail-building-n.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-wide-a", url: `${assetBase}/low-detail-building-wide-a.glb`, category: "lowDetail", weight: 1 },
  { id: "low-detail-building-wide-b", url: `${assetBase}/low-detail-building-wide-b.glb`, category: "lowDetail", weight: 1 },
  { id: "detail-awning", url: `${assetBase}/detail-awning.glb`, category: "detail", weight: 1 },
  { id: "detail-awning-wide", url: `${assetBase}/detail-awning-wide.glb`, category: "detail", weight: 1 },
  { id: "detail-overhang", url: `${assetBase}/detail-overhang.glb`, category: "detail", weight: 1 },
  { id: "detail-overhang-wide", url: `${assetBase}/detail-overhang-wide.glb`, category: "detail", weight: 1 },
  { id: "detail-parasol-a", url: `${assetBase}/detail-parasol-a.glb`, category: "detail", weight: 1 },
  { id: "detail-parasol-b", url: `${assetBase}/detail-parasol-b.glb`, category: "detail", weight: 1 },
];

export const assetsById = new Map(assetCatalog.map((asset) => [asset.id, asset]));
