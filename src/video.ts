import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { parseMotionPrompt } from './engine';
import type { MotionPlan } from './types';

export interface RenderOptions {
  sourceImage: string;
  prompt: string;
  duration: 3 | 4 | 5;
  portrait?: boolean;
  onProgress?: (progress: number) => void;
}

interface CodecSupport {
  supported?: boolean;
}

function ease(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The source image could not be loaded.'));
    image.src = source;
  });
}

function sizeFor(image: HTMLImageElement, portrait?: boolean): { width: number; height: number } {
  const usePortrait = portrait ?? image.naturalHeight > image.naturalWidth;
  return usePortrait ? { width: 480, height: 854 } : { width: 854, height: 480 };
}

export function drawMotionFrame(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number,
  progress: number,
  plan: MotionPlan,
): void {
  const curved = ease(progress);
  const phase = progress * Math.PI * 2 * plan.speed;
  const cover = Math.max(width / imageWidth, height / imageHeight);
  const zoom = 1 + 0.08 + plan.zoom * curved + Math.sin(phase) * plan.pulse;
  const drawWidth = imageWidth * cover * zoom;
  const drawHeight = imageHeight * cover * zoom;
  const baseX = (width - drawWidth) / 2;
  const baseY = (height - drawHeight) / 2;
  const panX = width * plan.panX * curved;
  const panY = height * plan.panY * curved;
  const shakeX = Math.sin(phase * 9) * width * plan.shake * (1 - progress * 0.7);
  const shakeY = Math.cos(phase * 11) * height * plan.shake * (1 - progress * 0.7);
  const sway = Math.sin(phase) * plan.sway;
  const rotation = (plan.rotation * (curved - 0.5) + sway) * Math.PI;

  context.save();
  context.fillStyle = '#05060a';
  context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2);
  context.rotate(rotation);
  context.translate(-width / 2, -height / 2);
  context.drawImage(image, baseX + panX + shakeX, baseY + panY + shakeY, drawWidth, drawHeight);
  const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.1, width / 2, height / 2, width * 0.68);
  vignette.addColorStop(0.5, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.34)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  context.restore();
}

export async function startPreview(
  canvas: HTMLCanvasElement,
  sourceImage: string,
  prompt: string,
  duration: number,
): Promise<() => void> {
  const image = await loadImage(sourceImage);
  const dimensions = sizeFor(image);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable on this device.');
  const plan = parseMotionPrompt(prompt);
  let stopped = false;
  const start = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    if (stopped) return;
    const progress = ((now - start) / (duration * 1000)) % 1;
    drawMotionFrame(context, image, image.naturalWidth, image.naturalHeight, canvas.width, canvas.height, progress, plan);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}

async function supportsMp4(width: number, height: number, fps: number): Promise<boolean> {
  const Encoder = (globalThis as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  if (!Encoder) return false;
  try {
    const result = (await Encoder.isConfigSupported({
      codec: 'avc1.42001f',
      width,
      height,
      bitrate: 1_800_000,
      framerate: fps,
    })) as CodecSupport;
    return result.supported === true;
  } catch {
    return false;
  }
}

async function renderMp4(options: RenderOptions, image: HTMLImageElement): Promise<Blob> {
  const fps = 12;
  const dimensions = sizeFor(image, options.portrait);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable on this device.');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: canvas.width,
      height: canvas.height,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encoderError: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure({
    codec: 'avc1.42001f',
    width: canvas.width,
    height: canvas.height,
    bitrate: 1_800_000,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
  });
  const plan = parseMotionPrompt(options.prompt);
  const totalFrames = options.duration * fps;
  for (let index = 0; index < totalFrames; index += 1) {
    const progress = totalFrames <= 1 ? 1 : index / (totalFrames - 1);
    drawMotionFrame(context, image, image.naturalWidth, image.naturalHeight, canvas.width, canvas.height, progress, plan);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1_000_000) / fps) });
    encoder.encode(frame, { keyFrame: index % fps === 0 });
    frame.close();
    options.onProgress?.(Math.round(((index + 1) / totalFrames) * 94));
    if (index % 5 === 0) await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  muxer.finalize();
  options.onProgress?.(100);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

async function renderWebm(options: RenderOptions, image: HTMLImageElement): Promise<Blob> {
  const fps = 12;
  const dimensions = sizeFor(image, options.portrait);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context || !canvas.captureStream || typeof MediaRecorder === 'undefined') {
    throw new Error('This device does not expose a compatible video encoder.');
  }
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
  const recorder = new MediaRecorder(canvas.captureStream(fps), { mimeType, videoBitsPerSecond: 1_600_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const completion = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Video encoding failed.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });
  const plan = parseMotionPrompt(options.prompt);
  recorder.start(250);
  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / (options.duration * 1000));
      drawMotionFrame(context, image, image.naturalWidth, image.naturalHeight, canvas.width, canvas.height, progress, plan);
      options.onProgress?.(Math.round(progress * 96));
      if (progress < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  const blob = await completion;
  options.onProgress?.(100);
  return blob;
}

export async function renderQuickClip(options: RenderOptions): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  if (!options.sourceImage) throw new Error('Select an image before rendering.');
  const image = await loadImage(options.sourceImage);
  const dimensions = sizeFor(image, options.portrait);
  if (await supportsMp4(dimensions.width, dimensions.height, 12)) {
    return { blob: await renderMp4(options, image), extension: 'mp4' };
  }
  return { blob: await renderWebm(options, image), extension: 'webm' };
}
