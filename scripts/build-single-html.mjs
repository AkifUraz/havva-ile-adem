import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
const assetsDir = path.join(publicDir, "assets");
const rootOutput = path.join(rootDir, "game.html");
const distOutput = path.join(distDir, "game.html");

const mimeByExtension = new Map([
  [".glb", "model/gltf-binary"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

const indexHtml = await readFile(path.join(distDir, "index.html"), "utf8");
const scriptMatch = indexHtml.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
const styleMatch = indexHtml.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);

if (!scriptMatch) {
  throw new Error("Could not find bundled module script in dist/index.html");
}

const scriptSource = await readFile(path.join(distDir, scriptMatch[1].replace(/^\//, "")), "utf8");
const styleSource = styleMatch ? await readFile(path.join(distDir, styleMatch[1].replace(/^\//, "")), "utf8") : "";
const assetMap = await createEmbeddedAssetMap(assetsDir);
const assetBootstrap = `window.__CITY_SANDBOX_ASSETS__=${JSON.stringify(assetMap)};`;
const scriptDataUrl = `data:text/javascript;base64,${Buffer.from(scriptSource, "utf8").toString("base64")}`;

const singleHtml = indexHtml
  .replace(styleMatch?.[0] ?? "", styleSource ? `<style>\n${styleSource}\n</style>` : "")
  .replace(scriptMatch[0], `<script>\n${assetBootstrap}\n</script>\n<script type="module" src="${scriptDataUrl}"></script>`);

await writeFile(rootOutput, singleHtml, "utf8");
await writeFile(distOutput, singleHtml, "utf8");

async function createEmbeddedAssetMap(directory) {
  const files = await listFiles(directory);
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const extension = path.extname(filePath).toLowerCase();
      const mime = mimeByExtension.get(extension);

      if (!mime) {
        return undefined;
      }

      const relativeToPublic = path.relative(publicDir, filePath).split(path.sep).join("/");
      const content = await readFile(filePath);
      return [`/${relativeToPublic}`, `data:${mime};base64,${content.toString("base64")}`];
    }),
  );

  return Object.fromEntries(entries.filter(Boolean));
}

async function listFiles(directory) {
  const items = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    items.map(async (item) => {
      const itemPath = path.join(directory, item.name);
      return item.isDirectory() ? listFiles(itemPath) : [itemPath];
    }),
  );

  return nested.flat();
}
