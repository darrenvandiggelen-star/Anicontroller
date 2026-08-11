package za.co.anicontroller.studio;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Native boundary for offline inference.
 *
 * The web layer checks isReady() before calling characterReply(). This plugin
 * deliberately reports the truth until a compatible llama.cpp library and
 * model are installed; it never sends a prompt to a remote fallback.
 */
@CapacitorPlugin(name = "LocalAi")
public class LocalAiPlugin extends Plugin {
    private static final String CHAT_MODEL = "qwen3-1.7b-q4.gguf";

    private File modelDirectory() {
        File directory = new File(getContext().getFilesDir(), "models");
        if (!directory.exists()) {
            //noinspection ResultOfMethodCallIgnored
            directory.mkdirs();
        }
        return directory;
    }

    private File chatModel() {
        return new File(modelDirectory(), CHAT_MODEL);
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ready", chatModel().isFile());
        result.put("chatModelInstalled", chatModel().isFile());
        result.put("runtimeInstalled", false);
        call.resolve(result);
    }

    @PluginMethod
    public void runtimeInfo(PluginCall call) {
        StatFs storage = new StatFs(getContext().getFilesDir().getAbsolutePath());
        JSObject result = new JSObject();
        result.put("modelDirectory", modelDirectory().getAbsolutePath());
        result.put("availableStorageBytes", storage.getAvailableBytes());
        result.put("thermalStatus", currentThermalStatus());
        result.put("batteryTemperatureC", batteryTemperatureC());
        result.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        result.put("androidApi", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @PluginMethod
    public void characterReply(PluginCall call) {
        if (!chatModel().isFile()) {
            call.reject("The local character model has not been installed.", "MODEL_NOT_INSTALLED");
            return;
        }
        call.reject(
            "The model file exists, but the native llama.cpp runtime is not linked in this milestone.",
            "RUNTIME_NOT_INSTALLED"
        );
    }

    private int currentThermalStatus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1;
        PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return manager == null ? -1 : manager.getCurrentThermalStatus();
    }

    private double batteryTemperatureC() {
        Intent status = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (status == null) return -1;
        int tenths = status.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -10);
        return tenths / 10.0;
    }
}
