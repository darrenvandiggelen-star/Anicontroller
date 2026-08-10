export type AnimeStyle = 'soft' | 'cel' | 'manga';

interface StyleConfig {
  levels: number;
  saturation: number;
  contrast: number;
  edgeThreshold: number;
  edgeStrength: number;
}

const STYLE_CONFIG: Record<AnimeStyle, StyleConfig> = {
  soft: { levels: 7, saturation: 1.12, contrast: 1.05, edgeThreshold: 42, edgeStrength: 0.48 },
  cel: { levels: 5, saturation: 1.28, contrast: 1.12, edgeThreshold: 34, edgeStrength: 0.72 },
  manga: { levels: 4, saturation: 0.18, contrast: 1.3, edgeThreshold: 26, edgeStrength: 0.9 },
};

const clamp = (value: number) => Math.max(0, Math.min(255, value));

function adjustChannel(value: number, contrast: number): number {
  return clamp((value - 128) * contrast + 128);
}

function quantize(value: number, levels: number): number {
  const step = 255 / Math.max(2, levels - 1);
  return clamp(Math.round(value / step) * step);
}

function saturationAdjust(r: number, g: number, b: number, amount: number): [number, number, number] {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return [
    clamp(gray + (r - gray) * amount),
    clamp(gray + (g - gray) * amount),
    clamp(gray + (b - gray) * amount),
  ];
}

function luminance(data: Uint8ClampedArray, offset: number): number {
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

export async function stylizePhoto(file: File, style: AnimeStyle): Promise<File> {
  const config = STYLE_CONFIG[style];
  const bitmap = await createImageBitmap(file);
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas rendering is not available on this device.');

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, width, height);
  const original = new Uint8ClampedArray(image.data);
  const output = image.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let r = adjustChannel(original[i], config.contrast);
      let g = adjustChannel(original[i + 1], config.contrast);
      let b = adjustChannel(original[i + 2], config.contrast);
      [r, g, b] = saturationAdjust(r, g, b, config.saturation);

      r = quantize(r, config.levels);
      g = quantize(g, config.levels);
      b = quantize(b, config.levels);

      const rightOffset = (y * width + Math.min(width - 1, x + 1)) * 4;
      const downOffset = (Math.min(height - 1, y + 1) * width + x) * 4;
      const centerLum = luminance(original, i);
      const edge = Math.abs(centerLum - luminance(original, rightOffset)) + Math.abs(centerLum - luminance(original, downOffset));

      if (edge > config.edgeThreshold) {
        const darken = 1 - config.edgeStrength;
        r *= darken;
        g *= darken;
        b *= darken;
      }

      if (style === 'manga') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const manga = gray > 205 ? 255 : gray > 145 ? 195 : gray > 85 ? 105 : 25;
        r = manga;
        g = manga;
        b = manga;
      }

      output[i] = clamp(r);
      output[i + 1] = clamp(g);
      output[i + 2] = clamp(b);
    }
  }

  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create the anime image.')), 'image/png', 0.95);
  });

  const base = file.name.replace(/\.[^.]+$/, '') || 'character';
  return new File([blob], `${base}-${style}-anime.png`, { type: 'image/png' });
}
