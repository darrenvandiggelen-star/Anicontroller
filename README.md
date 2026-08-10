# Anicontroller

Anicontroller is an Android-first live virtual anime character controller.

The app separates **character control** from **chat intelligence**:

- The Director executes explicit user movement, pose, expression and camera commands directly.
- Chat can use a local or user-selected AI endpoint without owning the animation layer.
- VRM characters can be loaded from Android storage.
- A person photo can be converted locally into an anime-style 2D character.
- Character bones can be rotated precisely with sliders or typed commands when using a VRM.
- Expressions can be set with exact weights on compatible VRM characters.
- GitHub Actions builds a debug APK from `main`.

## Character modes

### 3D VRM

Use VRM 0.x / VRM 1.0 characters for full rig control. The Director can directly control humanoid bones, expressions, camera position and supported gestures.

Example commands:

```text
raise right arm 45 degrees
rotate left upper arm x 25
turn head left 20 degrees
look up 15 degrees
smile 80
set happy 0.7
reset pose
camera front
camera close
```

### Photo → Anime

Choose a photo from the Android device and create a stylized 2D character locally. The original image is not uploaded by the built-in converter.

Built-in looks:

- Soft Anime
- Cel Shaded
- Manga

Photo characters support whole-avatar commands such as:

```text
tilt left 15
move right 40
move up 25
zoom 125
bounce
shake
nod
reset pose
```

A single flat photograph cannot provide independent arm, leg, hand or facial bones. Exact limb control requires a rigged VRM character.

## Live chat

The chat panel includes a local fallback and can be connected to a user-selected OpenAI-compatible endpoint. The conversational AI is kept separate from the Director so it does not own or veto animation controls.

## Character library

Imported VRMs and generated photo characters are stored in the app's local IndexedDB character library so they can be selected again without re-importing every session.

## Development

Requirements: Node.js 22+, Java 21 and Android SDK for local APK builds.

```bash
npm install
npm run dev
```

Create/sync the Android project locally:

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

## GitHub APK build

Open **Actions → Build Android APK** after a successful push. Download the `anicontroller-debug-apk` artifact from the completed workflow run.

## Characters and rights

Anicontroller does not redistribute copyrighted anime character models. Use VRM models and photographs you own, created, licensed, or otherwise have permission to use.

## Roadmap

- Higher-quality optional AI image stylization provider
- Photo-to-rigged-avatar workflow
- Saved pose presets
- VRMA/custom animation import
- Keyframe timeline
- Android speech recognition and TTS
- Lip sync and emotion-driven facial animation
- Local on-device LLM option
- Motion recording and playback
- Scene/background selection
- Touch/drag inverse-kinematics controls
