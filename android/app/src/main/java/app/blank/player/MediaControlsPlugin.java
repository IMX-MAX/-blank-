package app.blank.player;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaControls")
public class MediaControlsPlugin extends Plugin {
    private boolean askedForNotifications;

    @Override
    public void load() {
        PlaybackService.setListener((action, positionMs) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            data.put("position", positionMs / 1000.0);
            notifyListeners("action", data);
        });
    }

    @PluginMethod
    public void update(PluginCall call) {
        askForNotifications();
        PlaybackService.State state = new PlaybackService.State();
        state.title = call.getString("title", "");
        state.artist = call.getString("artist", "");
        state.album = call.getString("album", "");
        state.durationMs = Math.round(call.getDouble("durationMs", 0.0));
        state.positionMs = Math.round(call.getDouble("positionMs", 0.0));
        state.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        String artwork = call.getString("artwork");
        if (artwork != null && !artwork.isEmpty()) {
            byte[] bytes = Base64.decode(artwork, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap != null) state.artwork = bitmap;
        }
        state.trackId = call.getString("trackId");
        state.keepArtwork = artwork == null;
        JSArray waveform = call.getArray("peaks");
        if (waveform != null && waveform.length() > 0) {
            float[] values = new float[waveform.length()];
            for (int i = 0; i < values.length; i++) values[i] = (float) waveform.optDouble(i, 0);
            state.peaks = values;
        }
        PlaybackService.update(getContext().getApplicationContext(), state);
        call.resolve();
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                if (on) {
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        PlaybackService.stop(getContext().getApplicationContext());
        call.resolve();
    }

    private void askForNotifications() {
        if (askedForNotifications || Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        askedForNotifications = true;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4242);
        }
    }
}
