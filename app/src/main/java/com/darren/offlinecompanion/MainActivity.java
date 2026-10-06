package com.darren.offlinecompanion;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.common.PointF3D;
import com.google.mlkit.vision.common.Triangle;
import com.google.mlkit.vision.facemesh.FaceMesh;
import com.google.mlkit.vision.facemesh.FaceMeshDetection;
import com.google.mlkit.vision.facemesh.FaceMeshDetector;
import com.google.mlkit.vision.facemesh.FaceMeshDetectorOptions;
import com.google.mlkit.vision.facemesh.FaceMeshPoint;
import com.google.mlkit.vision.pose.Pose;
import com.google.mlkit.vision.pose.PoseDetection;
import com.google.mlkit.vision.pose.PoseDetector;
import com.google.mlkit.vision.pose.PoseLandmark;
import com.google.mlkit.vision.pose.accurate.AccuratePoseDetectorOptions;
import com.google.mlkit.vision.segmentation.Segmentation;
import com.google.mlkit.vision.segmentation.SegmentationMask;
import com.google.mlkit.vision.segmentation.Segmenter;
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 4101;
    private static final int AUDIO_PERMISSION = 4102;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;

    private FaceMeshDetector faceMeshDetector;
    private PoseDetector poseDetector;
    private Segmenter segmenter;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, FILE_CHOOSER);
                } catch (Exception ex) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.loadUrl("file:///android_asset/index.html");
    }

    private boolean ensureVisionEngines() {
        try {
            if (faceMeshDetector == null) {
                faceMeshDetector = FaceMeshDetection.getClient(
                        new FaceMeshDetectorOptions.Builder()
                                .setUseCase(FaceMeshDetectorOptions.FACE_MESH)
                                .build());
            }

            if (poseDetector == null) {
                AccuratePoseDetectorOptions poseOptions =
                        new AccuratePoseDetectorOptions.Builder()
                                .setDetectorMode(AccuratePoseDetectorOptions.SINGLE_IMAGE_MODE)
                                .build();
                poseDetector = PoseDetection.getClient(poseOptions);
            }

            if (segmenter == null) {
                SelfieSegmenterOptions segmentOptions =
                        new SelfieSegmenterOptions.Builder()
                                .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
                                .build();
                segmenter = Segmentation.getClient(segmentOptions);
            }

            return true;
        } catch (Throwable t) {
            jsAvatarError("Avatar engine could not start on this device: " +
                    (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()));
            return false;
        }
    }

    private void ensureTtsAndSpeak(String text) {
        if (text == null || text.trim().isEmpty()) return;

        try {
            if (tts == null) {
                tts = new TextToSpeech(this, status -> {
                    if (status == TextToSpeech.SUCCESS) {
                        try {
                            int result = tts.setLanguage(new Locale("en", "ZA"));
                            if (result == TextToSpeech.LANG_MISSING_DATA ||
                                    result == TextToSpeech.LANG_NOT_SUPPORTED) {
                                tts.setLanguage(Locale.US);
                            }
                            tts.setOnUtteranceProgressListener(
                                    new UtteranceProgressListener() {
                                        @Override public void onStart(String utteranceId) {
                                            jsTalking(true);
                                        }
                                        @Override public void onDone(String utteranceId) {
                                            jsTalking(false);
                                        }
                                        @Override public void onError(String utteranceId) {
                                            jsTalking(false);
                                        }
                                    });
                            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "companion_reply");
                        } catch (Throwable ignored) {
                            jsTalking(false);
                        }
                    } else {
                        jsTalking(false);
                    }
                });
            } else {
                tts.stop();
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "companion_reply");
            }
        } catch (Throwable t) {
            jsTalking(false);
        }
    }

    private Bitmap decodeDataUrl(String dataUrl, int maxDimension) {
        try {
            String raw = dataUrl;
            int comma = raw.indexOf(',');
            if (comma >= 0) raw = raw.substring(comma + 1);
            byte[] bytes = Base64.decode(raw, Base64.DEFAULT);
            Bitmap src = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (src == null) return null;

            int w = src.getWidth();
            int h = src.getHeight();
            int max = Math.max(w, h);
            if (max <= maxDimension) return src;

            float scale = maxDimension / (float) max;
            int nw = Math.max(1, Math.round(w * scale));
            int nh = Math.max(1, Math.round(h * scale));
            Bitmap scaled = Bitmap.createScaledBitmap(src, nw, nh, true);
            if (scaled != src) src.recycle();
            return scaled;
        } catch (Exception e) {
            return null;
        }
    }

    private String bitmapToDataUrl(Bitmap bitmap) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        return "data:image/png;base64," +
                Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    private Bitmap applySegmentation(Bitmap src, SegmentationMask mask) {
        int w = src.getWidth();
        int h = src.getHeight();
        int mw = mask.getWidth();
        int mh = mask.getHeight();

        int[] pixels = new int[w * h];
        int[] output = new int[w * h];
        src.getPixels(pixels, 0, w, 0, 0, w, h);

        ByteBuffer buffer = mask.getBuffer();
        buffer.order(ByteOrder.nativeOrder());

        for (int y = 0; y < h; y++) {
            int my = Math.min(mh - 1, Math.max(0, (int) ((y / (float) h) * mh)));
            for (int x = 0; x < w; x++) {
                int mx = Math.min(mw - 1, Math.max(0, (int) ((x / (float) w) * mw)));
                int offset = (my * mw + mx) * 4;
                float confidence = buffer.getFloat(offset);

                float a = (confidence - 0.12f) / 0.70f;
                a = Math.max(0f, Math.min(1f, a));
                a = a * a * (3f - 2f * a);

                int c = pixels[y * w + x];
                output[y * w + x] = Color.argb(
                        Math.round(a * 255f),
                        Color.red(c),
                        Color.green(c),
                        Color.blue(c));
            }
        }

        Bitmap result = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        result.setPixels(output, 0, w, 0, 0, w, h);
        return result;
    }

    private JSONArray poseToJson(Pose pose, int width, int height) throws Exception {
        JSONArray arr = new JSONArray();
        for (PoseLandmark p : pose.getAllPoseLandmarks()) {
            JSONArray row = new JSONArray();
            row.put(p.getLandmarkType());
            row.put(p.getPosition().x / Math.max(1f, width));
            row.put(p.getPosition().y / Math.max(1f, height));
            row.put(p.getPosition3D().getZ() / Math.max(1f, width));
            row.put(p.getInFrameLikelihood());
            arr.put(row);
        }
        return arr;
    }

    private JSONArray faceToJson(FaceMesh mesh, int width, int height) throws Exception {
        JSONArray arr = new JSONArray();
        if (mesh == null) return arr;

        for (FaceMeshPoint p : mesh.getAllPoints()) {
            PointF3D q = p.getPosition();
            JSONArray row = new JSONArray();
            row.put(p.getIndex());
            row.put(q.getX() / Math.max(1f, width));
            row.put(q.getY() / Math.max(1f, height));
            row.put(q.getZ() / Math.max(1f, width));
            arr.put(row);
        }
        return arr;
    }

    private JSONArray faceTrianglesToJson(FaceMesh mesh) throws Exception {
        JSONArray arr = new JSONArray();
        if (mesh == null) return arr;

        for (Triangle<FaceMeshPoint> triangle : mesh.getAllTriangles()) {
            List<FaceMeshPoint> points = triangle.getAllPoints();
            if (points.size() < 3) continue;
            JSONArray row = new JSONArray();
            row.put(points.get(0).getIndex());
            row.put(points.get(1).getIndex());
            row.put(points.get(2).getIndex());
            arr.put(row);
        }
        return arr;
    }

    private void buildFullAvatar(String fullDataUrl, String faceDataUrl) {
        if (!ensureVisionEngines()) return;

        Bitmap full = decodeDataUrl(fullDataUrl, 640);
        Bitmap face = decodeDataUrl(faceDataUrl, 512);

        if (full == null || face == null) {
            jsAvatarError("Could not read the selected photo.");
            return;
        }

        InputImage fullInput = InputImage.fromBitmap(full, 0);
        InputImage faceInput = InputImage.fromBitmap(face, 0);

        poseDetector.process(fullInput)
                .addOnSuccessListener(pose -> {
                    segmenter.process(fullInput)
                            .addOnSuccessListener(mask -> {
                                faceMeshDetector.process(faceInput)
                                        .addOnSuccessListener(meshes -> {
                                            FaceMesh mesh =
                                                    (meshes == null || meshes.isEmpty())
                                                            ? null : meshes.get(0);
                                            sendAvatarResult(full, face, pose, mask, mesh);
                                        })
                                        .addOnFailureListener(e ->
                                                sendAvatarResult(full, face, pose, mask, null));
                            })
                            .addOnFailureListener(e ->
                                    jsAvatarError("Person cut-out failed: " + e.getMessage()));
                })
                .addOnFailureListener(e ->
                        jsAvatarError("Full-body detection failed: " + e.getMessage()));
    }

    private void sendAvatarResult(
            Bitmap full,
            Bitmap face,
            Pose pose,
            SegmentationMask mask,
            FaceMesh mesh) {
        try {
            Bitmap cutout = applySegmentation(full, mask);

            JSONObject out = new JSONObject();
            out.put("width", full.getWidth());
            out.put("height", full.getHeight());
            out.put("personTexture", bitmapToDataUrl(cutout));
            out.put("pose", poseToJson(pose, full.getWidth(), full.getHeight()));
            out.put("face", faceToJson(mesh, face.getWidth(), face.getHeight()));
            out.put("faceTriangles", faceTrianglesToJson(mesh));
            out.put("faceDetailed", mesh != null);

            final String js = "window.onFullAvatarBuilt(" + out.toString() + ")";
            runOnUiThread(() -> webView.evaluateJavascript(js, null));

            cutout.recycle();
        } catch (Exception e) {
            jsAvatarError("Avatar assembly failed: " + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER && fileCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERMISSION) {
            if (grantResults.length > 0 &&
                    grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startVoiceInternal();
            } else {
                jsSpeechError("Microphone permission was not granted.");
            }
        }
    }

    private void startVoiceInternal() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            jsSpeechError("No speech recognizer is installed on this phone.");
            return;
        }

        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }

        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onPartialResults(Bundle partialResults) {}
            @Override public void onEvent(int eventType, Bundle params) {}

            @Override
            public void onError(int error) {
                jsSpeechError("Voice recognition stopped. Error " + error + ".");
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> matches =
                        results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    jsSpeechResult(matches.get(0));
                } else {
                    jsSpeechError("I did not catch that.");
                }
            }
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-ZA");
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        recognizer.startListening(intent);
    }

    private void jsSpeechResult(String value) {
        final String js =
                "window.onNativeSpeechResult(" + JSONObject.quote(value) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void jsSpeechError(String value) {
        final String js =
                "window.onNativeSpeechError(" + JSONObject.quote(value) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void jsAvatarError(String value) {
        final String js =
                "window.onAvatarBuildError(" + JSONObject.quote(value) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void jsTalking(boolean value) {
        final String js = "window.onNativeTalking(" + (value ? "true" : "false") + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void startVoice() {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(
                            new String[]{Manifest.permission.RECORD_AUDIO},
                            AUDIO_PERMISSION);
                } else {
                    startVoiceInternal();
                }
            });
        }

        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> ensureTtsAndSpeak(text));
        }

        @JavascriptInterface
        public void buildFullAvatar(String fullDataUrl, String faceDataUrl) {
            buildFullAvatar(fullDataUrl, faceDataUrl);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (recognizer != null) recognizer.destroy();
        if (faceMeshDetector != null) {
            try { faceMeshDetector.close(); } catch (Throwable ignored) {}
        }
        if (poseDetector != null) {
            try { poseDetector.close(); } catch (Exception ignored) {}
        }
        if (segmenter != null) {
            try { segmenter.close(); } catch (Exception ignored) {}
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
