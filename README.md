# Anicontroller

Anicontroller is an Android-first live virtual anime character controller.

The app separates **character control** from **chat intelligence**:

- The Director executes explicit user movement, pose, expression and camera commands directly.
- Chat can use a local or user-selected AI endpoint without owning the animation layer.
- VRM characters can be loaded from Android storage.
- Character bones can be rotated precisely with sliders or typed commands.
- Expressions can be set with exact weights.
- GitHub Actions builds a debug APK on every push to `main`.

## First version

- 3D VRM 0.x / 1.0 character loading with `@pixiv/three-vrm`
- Android packaging with Capacitor
- Touch orbit camera
- Manual bone controls
- Expression controls
- Natural-language Director command parser
- Command queue with exact execution
- Chat panel with a local fallback persona and a pluggable OpenAI-compatible endpoint
- Character profile/personality fields
- Reset pose and camera controls

## Example Director commands

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

Director commands are intentionally handled separately from the conversational AI. If a command can be represented by the supported character rig, it is executed by the controller rather than negotiated with the character persona.

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

Open **Actions → Build Android APK** after a push. Download the `anicontroller-debug-apk` artifact when the workflow completes.

## Characters

Anicontroller does not redistribute copyrighted anime character models. Use VRM models you created, licensed, or otherwise have permission to use. The character picker stores locally imported VRM files as user-selected characters.

## Roadmap

- Saved character library with thumbnails
- VRMA/custom animation import
- Keyframe timeline and pose presets
- Android speech recognition and TTS
- Lip sync and emotion-driven facial animation
- Local on-device LLM option
- OpenAI-compatible endpoint configuration
- Motion recording and playback
- Scene/background selection
- Touch/drag inverse-kinematics controls
