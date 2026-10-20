// Renders the SVG sources in assets/ to the PNG sizes required by the
// browsers and the stores. Run with `pnpm icons` after editing the artwork.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconSource = resolve(root, 'assets/icon.svg');

const outputs = [
  // Extension icons, picked up by WXT from public/icon/<size>.png.
  ...[16, 32, 48, 96, 128].map((size) => ({
    source: iconSource,
    size,
    file: `public/icon/${size}.png`,
  })),
  // Store listing assets.
  { source: iconSource, size: 128, file: 'assets/store/icon-128.png' },
  { source: iconSource, size: 300, file: 'assets/store/edge-logo-300.png' },
  {
    source: resolve(root, 'assets/promo-tile.svg'),
    width: 440,
    height: 280,
    file: 'assets/store/promo-tile-440x280.png',
  },
];

for (const output of outputs) {
  const target = resolve(root, output.file);
  await mkdir(dirname(target), { recursive: true });
  const width = output.width ?? output.size;
  const height = output.height ?? output.size;
  await sharp(output.source, { density: 384 }).resize(width, height).png().toFile(target);
  console.log(`${output.file} (${width}x${height})`);
}
