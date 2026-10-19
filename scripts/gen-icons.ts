/**
 * One-off: rasterize public/icon.svg into the PWA-required PNG sizes
 * (192x192, 512x512). Run with `bun scripts/gen-icons.ts` whenever the
 * source SVG changes. sharp is already in node_modules as a transitive dep.
 */
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(
  fileURLToPath(new URL("../public/icon.svg", import.meta.url)),
);

for (const size of [192, 512]) {
  const out = fileURLToPath(
    new URL(`../public/icon-${size}.png`, import.meta.url),
  );
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(`wrote public/icon-${size}.png`);
}
