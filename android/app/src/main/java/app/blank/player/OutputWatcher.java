package app.blank.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/**
 * Notices when the sound is about to come out of the phone's speaker instead of headphones: Android's
 * "becoming noisy" broadcast (Bluetooth audio disconnected, wired headphones unplugged), plus any headphone-type
 * output being removed, which also covers switching from one Bluetooth device to another. Neither needs a
 * runtime permission. Lives as long as the playback service, so it works with the app in the background.
 */
final class OutputWatcher {

    interface Listener {
        void onOutputLost(String reason);
    }

    /** Ignores the second report of the same change (the broadcast and the device callback both fire). */
    private static final long DEBOUNCE_MS = 800;

    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AudioManager audio;
    private boolean registered;
    private long lastReport;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) report("becoming-noisy");
        }
    };

    private final Object deviceCallback;

    OutputWatcher(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.deviceCallback = Build.VERSION.SDK_INT >= 23 ? new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                for (AudioDeviceInfo device : removed) {
                    if (device.isSink() && isHeadphones(device.getType())) {
                        report("device-removed");
                        return;
                    }
                }
            }
        } : null;
    }

    /** Headphones, earbuds and other personal outputs. Bluetooth SCO (calls) is left out: it drops after every call. */
    static boolean isHeadphones(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
            case AudioDeviceInfo.TYPE_HEARING_AID:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER:
            case AudioDeviceInfo.TYPE_BLE_BROADCAST:
                return true;
            default:
                return false;
        }
    }

    void start() {
        if (registered) return;
        registered = true;
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
        else context.registerReceiver(noisy, filter);
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio != null && Build.VERSION.SDK_INT >= 23) {
            // Registering reports every device already present as "added"; only removals matter here.
            audio.registerAudioDeviceCallback((AudioDeviceCallback) deviceCallback, main);
        }
    }

    void stop() {
        if (!registered) return;
        registered = false;
        try {
            context.unregisterReceiver(noisy);
        } catch (IllegalArgumentException ignored) {
            // Already gone.
        }
        if (audio != null && Build.VERSION.SDK_INT >= 23) audio.unregisterAudioDeviceCallback((AudioDeviceCallback) deviceCallback);
        audio = null;
    }

    private void report(String reason) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastReport < DEBOUNCE_MS) return;
        lastReport = now;
        main.post(() -> listener.onOutputLost(reason));
    }
}
