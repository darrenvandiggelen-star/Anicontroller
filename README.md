# Anicontroller

Anicontroller is a private-first Android character studio. It supports local character profiles and memory, offline GGUF chat, prompt-driven Quick Animate clips, and local episode planning. Images and conversations stay on the device.

## Install the Android APK

Open the latest successful **Build Android APK** run under GitHub Actions and download the `Anicontroller-Android-APK` artifact. Extract the ZIP and install `Anicontroller-v0.3.0-debug.apk` on Android. If Android blocks it, allow installation from the browser or file manager you used to open the file.

The APK contains the app, but not a chat model. In the app's **Local AI** screen, import a GGUF model smaller than 2 GB; a Q4 model around 1–1.5 GB is appropriate for an 8 GB phone. The Quick Animate renderer works without a GGUF model.

Anicontroller is an Android-first, offline-first character studio. This clean rebuild connects three workflows:

- create persistent characters with a persona, backstory, appearance and local memory;
- chat with a character and turn `/video` or natural-language requests into animation jobs;
- animate anime artwork or normal photographs into 3–5 second, 480p clips.

## Current milestone

The current source is the first runnable foundation. It includes:

- Android-focused mobile interface;
- local character, chat, job and episode-project storage;
- working `/video` and “show me…” intent detection;
- working prompt-to-motion planner for quick animation;
- working 480p canvas renderer;
- MP4 export through hardware WebCodecs where available, with WebM fallback;
- import and private on-device storage for GGUF files smaller than 2 GB;
- an embedded wllama/llama.cpp-compatible runtime for real local character replies;
- Capacitor Android packaging configuration;
- a native Android bridge for thermal and future accelerated-runtime information;
- model manager that accurately distinguishes implemented and pending runtimes.

The app uses a clearly labelled demo response engine until a user imports and loads a compatible GGUF model. Once loaded, real character replies run through the embedded local runtime. A native C++ acceleration path, offline speech recognition, higher-quality TTS and phone-optimised AI keyframe generation remain future milestones.

## Web development

```bash
npm install
npm run dev
```

Run validation:

```bash
npm test
npm run build
```

## Android development

Android Studio, an Android SDK and Java 17 are required.

```bash
npm install
npm run android:add
npm run android:sync
npm run android:open
```

Build the debug APK from Android Studio or from the generated Android project:

```bash
cd android
./gradlew assembleDebug
```

The resulting APK is normally written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Privacy architecture

The application does not require an account or server. This Android manifest deliberately omits internet permission. Model binaries are imported by the user and stored in application-private storage. Heavy components are designed to load sequentially so the LLM, speech and animation models do not compete for the Huawei P50 Pro's 8 GB RAM.
