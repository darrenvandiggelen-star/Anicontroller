package com.darren.offlinecompanion;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
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

import org.json.JSONArray;
import org.json.JSONObject;

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

        faceMeshDetector = FaceMeshDetection.getClient(
                new FaceMeshDetectorOptions.Builder()
                        .setUseCase(FaceMeshDetectorOptions.FACE_MESH)
                        .build());

        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int result = tts.setLanguage(new Locale("en", "ZA"));
                if (result == TextToSpeech.LANG_MISSING_DATA ||
                    result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.US);
                }
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
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
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-ZA");
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        recognizer.startListening(intent);
    }

    private void jsSpeechResult(String value) {
        final String js = "window.onNativeSpeechResult(" + JSONObject.quote(value) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void jsSpeechError(String value) {
        final String js = "window.onNativeSpeechError(" + JSONObject.quote(value) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void jsAvatarError(String value) {
        final String js = "window.onAvatarBuildError(" + JSONObject.quote(value) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void buildAvatarMesh(String dataUrl) {
        try {
            String raw = dataUrl;
            int comma = raw.indexOf(',');
            if (comma >= 0) raw = raw.substring(comma + 1);

            byte[] bytes = Base64.decode(raw, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) {
                jsAvatarError("Could not read the selected face image.");
                return;
            }

            InputImage input = InputImage.fromBitmap(bitmap, 0);
            faceMeshDetector.process(input)
                    .addOnSuccessListener(meshes -> {
                        if (meshes == null || meshes.isEmpty()) {
                            jsAvatarError("No clear face mesh was found. Try a front-facing photo.");
                            return;
                        }

                        FaceMesh mesh = meshes.get(0);
                        try {
                            JSONObject out = new JSONObject();
                            out.put("width", bitmap.getWidth());
                            out.put("height", bitmap.getHeight());

                            android.graphics.Rect bb = mesh.getBoundingBox();
                            JSONArray bbox = new JSONArray();
                            bbox.put(bb.left); bbox.put(bb.top);
                            bbox.put(bb.right); bbox.put(bb.bottom);
                            out.put("bbox", bbox);

                            JSONArray points = new JSONArray();
                            for (FaceMeshPoint p : mesh.getAllPoints()) {
                                PointF3D q = p.getPosition();
                                JSONArray row = new JSONArray();
                                row.put(p.getIndex());
                                row.put(q.getX());
                                row.put(q.getY());
                                row.put(q.getZ());
                                points.put(row);
                            }
                            out.put("points", points);

                            JSONArray triangles = new JSONArray();
                            for (Triangle<FaceMeshPoint> tri : mesh.getAllTriangles()) {
                                List<FaceMeshPoint> tp = tri.getAllPoints();
                                if (tp.size() >= 3) {
                                    JSONArray row = new JSONArray();
                                    row.put(tp.get(0).getIndex());
                                    row.put(tp.get(1).getIndex());
                                    row.put(tp.get(2).getIndex());
                                    triangles.put(row);
                                }
                            }
                            out.put("triangles", triangles);

                            final String js = "window.onAvatarMeshBuilt(" + out.toString() + ")";
                            runOnUiThread(() -> webView.evaluateJavascript(js, null));
                        } catch (Exception ex) {
                            jsAvatarError("Avatar mesh conversion failed: " + ex.getMessage());
                        }
                    })
                    .addOnFailureListener(e ->
                            jsAvatarError("Face mesh failed: " + e.getMessage()));
        } catch (Exception e) {
            jsAvatarError("Avatar build failed: " + e.getMessage());
        }
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
            runOnUiThread(() -> {
                if (tts != null && text != null && !text.trim().isEmpty()) {
                    tts.stop();
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "companion_reply");
                }
            });
        }

        @JavascriptInterface
        public void buildAvatar(String faceDataUrl) {
            buildAvatarMesh(faceDataUrl);
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
            try { faceMeshDetector.close(); } catch (Exception ignored) {}
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
