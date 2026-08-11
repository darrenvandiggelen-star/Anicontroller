import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export interface FaceProfile {
  faceAspect: number;
  faceWidth: number;
  jawWidth: number;
  eyeSpacing: number;
  eyeWidth: number;
  noseLength: number;
  noseWidth: number;
  mouthWidth: number;
  mouthHeight: number;
  foreheadHeight: number;
  skinColor: string;
  hairColor: string;
  confidence: number;
}

export interface BodyProfile {
  heightCm: number;
  shoulderScale: number;
  chestScale: number;
  waistScale: number;
  hipScale: number;
  armScale: number;
  legScale: number;
  buildScale: number;
  source: 'manual' | 'photo';
}

export const DEFAULT_BODY_PROFILE: BodyProfile = {
  heightCm: 170,
  shoulderScale: 1,
  chestScale: 1,
  waistScale: 1,
  hipScale: 1,
  armScale: 1,
  legScale: 1,
  buildScale: 1,
  source: 'manual',
};

function localAsset(path: string): string {
  return new URL(`mediapipe/${path}`, document.baseURI).toString();
}

const WASM_PATH = localAsset('wasm');
const FACE_MODEL = localAsset('models/face_landmarker.task');
const POSE_MODEL = localAsset('models/pose_landmarker_lite.task');

let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;
let poseLandmarkerPromise: Promise<PoseLandmarker> | null = null;

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function vision() {
  if (!visionPromise) {
    visionPromise = FilesetResolver.forVisionTasks(WASM_PATH).catch((error) => {
      visionPromise = null;
      throw new Error(`Scanner engine could not start from the packaged WASM files: ${readableError(error)}`);
    });
  }
  return visionPromise;
}

async function faceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => FaceLandmarker.createFromOptions(await vision(), {
      baseOptions: { modelAssetPath: FACE_MODEL },
      runningMode: 'IMAGE',
      numFaces: 1,
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    }))().catch((error) => {
      faceLandmarkerPromise = null;
      throw new Error(`Face scanner model could not start: ${readableError(error)}`);
    });
  }
  return faceLandmarkerPromise;
}

async function poseLandmarker(): Promise<PoseLandmarker> {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = (async () => PoseLandmarker.createFromOptions(await vision(), {
      baseOptions: { modelAssetPath: POSE_MODEL },
      runningMode: 'IMAGE',
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
    }))().catch((error) => {
      poseLandmarkerPromise = null;
      throw new Error(`Body scanner model could not start: ${readableError(error)}`);
    });
  }
  return poseLandmarkerPromise;
}

async function imageFromBlob(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`The selected image could not be decoded: ${readableError(error)}`);
  }
  return { image, url };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ratio(value: number, base: number, fallback = 1): number {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0.0001) return fallback;
  return value / base;
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function sampleColor(image: HTMLImageElement, points: Array<{ x: number; y: number }>, fallback: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (const p of points) {
    const x = Math.round(clamp(p.x, 0.02, 0.98) * (canvas.width - 1));
    const y = Math.round(clamp(p.y, 0.02, 0.98) * (canvas.height - 1));
    const data = ctx.getImageData(x, y, 1, 1).data;
    if (data[3] > 0) {
      r += data[0]; g += data[1]; b += data[2]; count += 1;
    }
  }
  return count ? rgbToHex(r / count, g / count, b / count) : fallback;
}

export async function analyzeFace(blob: Blob): Promise<FaceProfile> {
  const { image, url } = await imageFromBlob(blob);
  try {
    const detector = await faceLandmarker();
    let result;
    try {
      result = detector.detect(image);
    } catch (error) {
      throw new Error(`Face scan failed while processing the photo: ${readableError(error)}`);
    }
    const lm = result.faceLandmarks?.[0];
    if (!lm || lm.length < 468) {
      throw new Error('No face landmarks were found. Use a well-lit front-facing adult photo with the whole face visible and no heavy blur, sunglasses or obstruction.');
    }

    const faceWidth = dist(lm[234], lm[454]);
    const faceHeight = dist(lm[10], lm[152]);
    const jawWidth = dist(lm[172], lm[397]);
    const eyeSpacing = dist(lm[133], lm[362]);
    const eyeWidth = (dist(lm[33], lm[133]) + dist(lm[362], lm[263])) / 2;
    const noseLength = dist(lm[168], lm[1]);
    const noseWidth = dist(lm[98], lm[327]);
    const mouthWidth = dist(lm[61], lm[291]);
    const mouthHeight = dist(lm[13], lm[14]);
    const foreheadHeight = dist(lm[10], lm[168]);

    const skinColor = sampleColor(image, [lm[50], lm[101], lm[280], lm[330]], '#d8aa8e');
    const hairPoint = { x: lm[10].x, y: Math.max(0.02, lm[10].y - faceHeight * 0.12) };
    const hairColor = sampleColor(image, [hairPoint], '#2b201e');

    return {
      faceAspect: clamp(ratio(faceHeight, faceWidth, 1.28), 1.0, 1.65),
      faceWidth: 1,
      jawWidth: clamp(ratio(jawWidth, faceWidth, 0.72), 0.48, 0.92),
      eyeSpacing: clamp(ratio(eyeSpacing, faceWidth, 0.34), 0.22, 0.52),
      eyeWidth: clamp(ratio(eyeWidth, faceWidth, 0.16), 0.1, 0.26),
      noseLength: clamp(ratio(noseLength, faceHeight, 0.24), 0.13, 0.38),
      noseWidth: clamp(ratio(noseWidth, faceWidth, 0.2), 0.11, 0.34),
      mouthWidth: clamp(ratio(mouthWidth, faceWidth, 0.38), 0.22, 0.58),
      mouthHeight: clamp(ratio(mouthHeight, faceHeight, 0.045), 0.018, 0.11),
      foreheadHeight: clamp(ratio(foreheadHeight, faceHeight, 0.28), 0.18, 0.42),
      skinColor,
      hairColor,
      confidence: 1,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export async function analyzeBody(blob: Blob, heightCm = 170): Promise<Partial<BodyProfile>> {
  const { image, url } = await imageFromBlob(blob);
  try {
    const detector = await poseLandmarker();
    let result;
    try {
      result = detector.detect(image);
    } catch (error) {
      throw new Error(`Body scan failed while processing the photo: ${readableError(error)}`);
    }
    const lm = result.landmarks?.[0];
    if (!lm || lm.length < 33) throw new Error('No full body pose detected. Use a standing photo with shoulders, hips, knees and feet visible.');

    const shoulder = dist(lm[11], lm[12]);
    const hips = dist(lm[23], lm[24]);
    const shoulderMid = midpoint(lm[11], lm[12]);
    const hipMid = midpoint(lm[23], lm[24]);
    const torso = dist(shoulderMid, hipMid);
    const leftLeg = dist(lm[23], lm[25]) + dist(lm[25], lm[27]);
    const rightLeg = dist(lm[24], lm[26]) + dist(lm[26], lm[28]);
    const leg = (leftLeg + rightLeg) / 2;
    const leftArm = dist(lm[11], lm[13]) + dist(lm[13], lm[15]);
    const rightArm = dist(lm[12], lm[14]) + dist(lm[14], lm[16]);
    const arm = (leftArm + rightArm) / 2;
    const bodyLength = Math.max(0.001, torso + leg);

    return {
      heightCm: clamp(heightCm, 130, 220),
      shoulderScale: clamp(ratio(shoulder, hips, 1.18) / 1.18, 0.72, 1.35),
      hipScale: clamp(ratio(hips, shoulder, 0.85) / 0.85, 0.72, 1.38),
      armScale: clamp(ratio(arm, bodyLength, 0.46) / 0.46, 0.82, 1.2),
      legScale: clamp(ratio(leg, bodyLength, 0.54) / 0.54, 0.82, 1.2),
      source: 'photo',
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
