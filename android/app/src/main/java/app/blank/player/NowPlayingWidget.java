package app.blank.player;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.widget.RemoteViews;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Home screen widget with the same content as the playback bar: what is playing, previous, play or pause,
 * next, shuffle and the waveform with the played part lit. The state comes from {@link PlaybackService},
 * and the buttons go back through it to the web app that owns the audio.
 */
public class NowPlayingWidget extends AppWidgetProvider {
    private static final String ACT_TOGGLE = "app.blank.player.widget.TOGGLE";
    private static final String ACT_NEXT = "app.blank.player.widget.NEXT";
    private static final String ACT_PREVIOUS = "app.blank.player.widget.PREVIOUS";
    private static final String ACT_SHUFFLE = "app.blank.player.widget.SHUFFLE";

    private static final String PREFS = "widget";
    private static final String ART_FILE = "widget_art.png";
    private static final int GOLD = 0xFFE6C84A;
    private static final int BARS = 70;
    private static final int WAVE_W = 560;
    private static final int WAVE_H = 72;
    private static final int ART_SIZE = 192;

    private static final class Snapshot {
        String title = "";
        String artist = "";
        String trackId = "";
        long durationMs;
        long positionMs;
        long savedAt;
        boolean playing;
        boolean shuffle;
        float[] peaks;
    }

    private static Snapshot current;
    private static Bitmap art;
    private static boolean artLoaded;
    private static Bitmap waveBitmap;

    /** Called with every state the app pushes while something plays. */
    static void onState(Context context, PlaybackService.State state) {
        Snapshot s = snapshot(context);
        boolean newTrack = state.trackId != null && !state.trackId.equals(s.trackId);
        s.title = state.title == null ? "" : state.title;
        s.artist = state.artist == null ? "" : state.artist;
        s.durationMs = state.durationMs;
        s.positionMs = state.positionMs;
        s.savedAt = SystemClock.elapsedRealtime();
        s.playing = state.playing;
        s.shuffle = state.shuffle;
        if (state.trackId != null) s.trackId = state.trackId;
        if (state.widgetPeaks != null && state.widgetPeaks.length > 0) s.peaks = state.widgetPeaks;
        else if (newTrack) s.peaks = null;
        if (state.artwork != null) setArt(context, state.artwork);
        save(context, s);
        render(context);
    }

    /** The service is gone: keep showing the song, but the buttons open the app instead. */
    static void onStopped(Context context) {
        Snapshot s = snapshot(context);
        s.positionMs = positionNow(s);
        s.playing = false;
        s.savedAt = SystemClock.elapsedRealtime();
        save(context, s);
        render(context);
    }

    /** Moves the played part of the waveform along while the screen is on. */
    static void tick(Context context) {
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power != null && !power.isInteractive()) return;
        if (current != null && current.playing) render(context);
    }

    private static Snapshot snapshot(Context context) {
        if (current != null) return current;
        Snapshot s = new Snapshot();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        s.title = prefs.getString("title", "");
        s.artist = prefs.getString("artist", "");
        s.trackId = prefs.getString("trackId", "");
        s.durationMs = prefs.getLong("durationMs", 0);
        s.positionMs = prefs.getLong("positionMs", 0);
        s.shuffle = prefs.getBoolean("shuffle", false);
        s.savedAt = SystemClock.elapsedRealtime();
        s.peaks = parsePeaks(prefs.getString("peaks", ""));
        current = s;
        return s;
    }

    private static void save(Context context, Snapshot s) {
        StringBuilder peaks = new StringBuilder();
        if (s.peaks != null) {
            for (int i = 0; i < s.peaks.length; i++) {
                if (i > 0) peaks.append(',');
                peaks.append(Math.round(s.peaks[i] * 100) / 100f);
            }
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("title", s.title)
            .putString("artist", s.artist)
            .putString("trackId", s.trackId)
            .putLong("durationMs", s.durationMs)
            .putLong("positionMs", positionNow(s))
            .putBoolean("shuffle", s.shuffle)
            .putString("peaks", peaks.toString())
            .apply();
    }

    private static float[] parsePeaks(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        String[] parts = raw.split(",");
        float[] out = new float[parts.length];
        try {
            for (int i = 0; i < parts.length; i++) out[i] = Float.parseFloat(parts[i]);
        } catch (NumberFormatException broken) {
            return null;
        }
        return out;
    }

    private static long positionNow(Snapshot s) {
        long position = s.positionMs + (s.playing ? SystemClock.elapsedRealtime() - s.savedAt : 0);
        return s.durationMs > 0 ? Math.min(position, s.durationMs) : Math.max(0, position);
    }

    private static void setArt(Context context, Bitmap source) {
        art = circle(source, ART_SIZE);
        artLoaded = true;
        try (FileOutputStream out = new FileOutputStream(new File(context.getFilesDir(), ART_FILE))) {
            art.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (Exception ignored) {
            // Without the saved copy the cover is just missing after a restart.
        }
    }

    private static Bitmap savedArt(Context context) {
        if (!artLoaded) {
            artLoaded = true;
            File file = new File(context.getFilesDir(), ART_FILE);
            if (file.exists()) art = BitmapFactory.decodeFile(file.getAbsolutePath());
        }
        return art;
    }

    private static Bitmap circle(Bitmap source, int size) {
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.drawOval(new RectF(0, 0, size, size), paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        int side = Math.min(source.getWidth(), source.getHeight());
        android.graphics.Rect from = new android.graphics.Rect(
            (source.getWidth() - side) / 2, (source.getHeight() - side) / 2,
            (source.getWidth() + side) / 2, (source.getHeight() + side) / 2);
        canvas.drawBitmap(source, from, new RectF(0, 0, size, size), paint);
        return out;
    }

    private static Bitmap drawWave(float[] peaks, int played) {
        if (waveBitmap == null) waveBitmap = Bitmap.createBitmap(WAVE_W, WAVE_H, Bitmap.Config.ARGB_8888);
        Bitmap bitmap = waveBitmap;
        bitmap.eraseColor(0);
        Canvas canvas = new Canvas(bitmap);
        float[] bars = WidgetBars.resample(peaks, BARS);
        float slot = (float) WAVE_W / BARS;
        float width = slot * 0.62f;
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        RectF bar = new RectF();
        for (int i = 0; i < BARS; i++) {
            paint.setColor(i < played ? GOLD : 0x59FFFFFF);
            float height = Math.max(width, bars[i] * WAVE_H);
            float left = i * slot + (slot - width) / 2f;
            bar.set(left, (WAVE_H - height) / 2f, left + width, (WAVE_H + height) / 2f);
            canvas.drawRoundRect(bar, width / 2f, width / 2f, paint);
        }
        return bitmap;
    }

    private static void render(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NowPlayingWidget.class));
        if (ids.length == 0) return;
        Snapshot s = snapshot(context);
        boolean hasSong = !s.title.isEmpty();
        boolean live = PlaybackService.isRunning();
        long position = positionNow(s);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_now_playing);
        views.setTextViewText(R.id.widget_title, hasSong ? s.title : "Nothing playing");
        views.setTextViewText(R.id.widget_artist, hasSong ? s.artist : "Open [blank] to play something");
        views.setTextViewText(R.id.widget_time, hasSong ? WidgetBars.clock(position) + " / " + WidgetBars.clock(s.durationMs) : "");
        Bitmap cover = savedArt(context);
        if (cover != null) views.setImageViewBitmap(R.id.widget_art, cover);
        else views.setImageViewResource(R.id.widget_art, R.drawable.ic_stat_music);
        views.setImageViewBitmap(R.id.widget_wave, drawWave(s.peaks, WidgetBars.playedBars(position, s.durationMs, BARS)));
        views.setImageViewResource(R.id.widget_play, s.playing ? R.drawable.ic_pause : R.drawable.ic_play);
        views.setInt(R.id.widget_shuffle, "setColorFilter", s.shuffle ? GOLD : 0xFFFFFFFF);

        PendingIntent open = openApp(context);
        views.setOnClickPendingIntent(R.id.widget_open, open);
        views.setOnClickPendingIntent(R.id.widget_wave, open);
        views.setOnClickPendingIntent(R.id.widget_time, open);
        views.setOnClickPendingIntent(R.id.widget_play, live ? control(context, ACT_TOGGLE) : open);
        views.setOnClickPendingIntent(R.id.widget_next, live ? control(context, ACT_NEXT) : open);
        views.setOnClickPendingIntent(R.id.widget_prev, live ? control(context, ACT_PREVIOUS) : open);
        views.setOnClickPendingIntent(R.id.widget_shuffle, live ? control(context, ACT_SHUFFLE) : open);
        manager.updateAppWidget(ids, views);
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 100, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent control(Context context, String action) {
        Intent intent = new Intent(context, NowPlayingWidget.class).setAction(action);
        return PendingIntent.getBroadcast(context, action.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String command = null;
        if (ACT_TOGGLE.equals(action)) command = snapshot(context).playing ? "pause" : "play";
        else if (ACT_NEXT.equals(action)) command = "next";
        else if (ACT_PREVIOUS.equals(action)) command = "previous";
        else if (ACT_SHUFFLE.equals(action)) command = "shuffle";
        if (command == null) {
            super.onReceive(context, intent);
            return;
        }
        if (!PlaybackService.isRunning()) {
            // The app is not running any more, so there is nothing to tell: open it instead.
            try {
                context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (RuntimeException ignored) {
                render(context);
            }
            return;
        }
        Snapshot s = snapshot(context);
        if (ACT_TOGGLE.equals(action)) {
            s.positionMs = positionNow(s);
            s.savedAt = SystemClock.elapsedRealtime();
            s.playing = !s.playing;
        } else if (ACT_SHUFFLE.equals(action)) {
            s.shuffle = !s.shuffle;
        }
        render(context);
        PlaybackService.dispatch(command);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        waveBitmap = null;
    }
}
