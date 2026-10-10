package app.blank.player;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

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
        state.keepArtwork = artwork == null;
        PlaybackService.update(getContext().getApplicationContext(), state);
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
