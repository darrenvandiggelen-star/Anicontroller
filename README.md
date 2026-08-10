# Anicontroller

Anicontroller is an Android-first live virtual anime character controller.

The app separates **character control** from **chat intelligence**. Director commands execute against the active rig, while chat can use a local or user-selected AI endpoint.

## Face → Real 3D

The Face → Real 3D workflow no longer pastes a photograph onto a generic head. It uses MediaPipe Face Landmarker to detect facial landmarks and derive measurable proportions for a parametric 3D head, including face aspect, jaw width, eye spacing/size, nose proportions, mouth proportions and forehead proportions. Skin and hair base colors are sampled locally from the photo.

A face photo cannot reveal the person's true body measurements. Anicontroller therefore supports two body paths:

1. Add an optional standing full-body photo. MediaPipe Pose Landmarker estimates shoulder/hip ratio plus arm and leg proportions.
2. Adjust height, shoulders, chest, waist, hips, arm length, leg length and overall build manually before creating the avatar.

The resulting avatar has a separate full-body joint hierarchy for hips, spine, chest, neck, head, shoulders, arms, hands, thighs, lower legs and feet.

The default/reset pose is lying on the bed.

Example Director commands:

```text
lie on bed
sit on bed then turn head left 20
stand up
roll left
raise right arm 60
rotate left upper leg x 45 then bend left elbow 70
smile 80
blink 100
```

## Wardrobe

Clothes are separate 3D meshes attached to the moving rig rather than baked into the body. Current wardrobe categories include:

- Tops: t-shirt, tank, hoodie, jacket, bodysuit
- Bottoms: jeans, shorts, skirt, leggings
- Shoes: sneakers, boots, barefoot
- Independent top, bottom and shoe colors

Wardrobe changes can be made from the controls or through Director commands:

```text
wear black hoodie
wear blue jeans then sit on bed
change bottom to shorts
wear white sneakers
remove shoes
```

## 3D VRM

VRM 0.x / VRM 1.0 import remains available for externally created characters. Compatible VRMs support humanoid bone control, expressions, camera position and gestures.

## Photo → Anime 2D

The older local photo stylizer remains available for quick 2D avatars with Soft Anime, Cel Shaded and Manga looks.

## Live chat

The chat panel includes a local fallback and can connect to a user-selected OpenAI-compatible endpoint. Chat remains separate from the Director animation layer.

## Character library

Imported VRMs, generated 2D characters and Face → Real 3D profiles are stored locally in IndexedDB.

## Development

Requirements: Node.js 22+, Java 21 and Android SDK for local APK builds.

```bash
npm install
npm run dev
```

Create/sync Android locally:

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

## GitHub APK build

GitHub Actions builds a debug APK from `main`. Open **Actions → Build Android APK** and download the `anicontroller-debug-apk` artifact from a successful run.

## Notes

MediaPipe image inference runs on the device. The WebAssembly runtime and model files are downloaded when the landmark scanner is first used, so the first Face → Real 3D scan needs network access unless those model assets are bundled into a future build.

Use photographs and character assets you own or have permission to use.

## Roadmap

- Bundle MediaPipe model files for fully offline first-run scanning
- Dense 3D morphable face mesh / higher-fidelity likeness
- Optional full-body segmentation for more detailed silhouette fitting
- Hair style generator and editor
- Larger modular wardrobe library
- Saved pose presets and keyframe timeline
- Android speech recognition and TTS
- Lip sync and emotion-driven facial animation
- Motion recording and playback
- Touch/drag inverse-kinematics controls
