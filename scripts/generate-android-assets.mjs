import { readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const root = new URL('..', import.meta.url).pathname;
const res = join(root, 'android/app/src/main/res');
const icon = await readFile(join(root, 'public/app-icon.svg'));

const launcherSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(launcherSizes)) {
  const directory = join(res, `mipmap-${density}`);
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await sharp(icon).resize(size, size).png().toFile(join(directory, name));
  }
  const foregroundSize = Math.round(size * 2.25);
  const innerSize = Math.round(foregroundSize * 0.72);
  const padding = Math.floor((foregroundSize - innerSize) / 2);
  await sharp(icon)
    .resize(innerSize, innerSize)
    .extend({
      top: padding,
      bottom: foregroundSize - innerSize - padding,
      left: padding,
      right: foregroundSize - innerSize - padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(join(directory, 'ic_launcher_foreground.png'));
}

for (const directoryName of await readdir(res)) {
  if (!directoryName.startsWith('drawable')) continue;
  const splashPath = join(res, directoryName, 'splash.png');
  let metadata;
  try {
    metadata = await sharp(splashPath).metadata();
  } catch {
    continue;
  }
  if (!metadata.width || !metadata.height) continue;
  const iconSize = Math.round(Math.min(metadata.width / 4, metadata.height / 3));
  const renderedIcon = await sharp(icon).resize(iconSize, iconSize).png().toBuffer();
  const temporary = `${splashPath}.next.png`;
  await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: '#090b12',
    },
  })
    .composite([{ input: renderedIcon, gravity: 'centre' }])
    .png()
    .toFile(temporary);
  await rename(temporary, splashPath);
}

console.log('Android icons and splash screens generated.');
