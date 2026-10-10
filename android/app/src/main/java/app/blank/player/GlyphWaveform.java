package app.blank.player;

import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import com.nothing.ketchum.Common;
import com.nothing.ketchum.Glyph;
import com.nothing.ketchum.GlyphMatrixManager;

import java.util.Arrays;

/**
 * Mirrors the playback waveform bar onto the Glyph Matrix on the back of supported Nothing phones.
 * Everything runs on the main thread, and position is extrapolated here so the display keeps moving
 * while the web view is throttled with the screen off.
 */
final class GlyphWaveform {
    private static final long TICK_MS = 250;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static boolean enabled;
    private static boolean connected;
    private static boolean connecting;
    private static GlyphMatrixManager manager;
    private static Context app;

    private static boolean hasTrack;
    private static float[] peaks;
    private static long durationMs;
    private static long positionMs;
    private static boolean playing;
    private static long stamp;
    private static int[] lastFrame;
    private static boolean shown;

    private GlyphWaveform() {}

    /** The matrix side length of this phone, or 0 when it has no Glyph Matrix this app can drive. */
    static int matrixLength() {
        if (Build.VERSION.SDK_INT < 33 || !"nothing".equalsIgnoreCase(Build.MANUFACTURER)) return 0;
        try {
            return Common.getDeviceMatrixLength();
        } catch (Throwable unavailable) {
            return 0;
        }
    }

    private static String deviceId() {
        return Common.is25111p() ? Glyph.DEVICE_25111p : Glyph.DEVICE_23112;
    }

    static void setEnabled(Context context, boolean on) {
        MAIN.post(() -> {
            app = context.getApplicationContext();
            if (on == enabled) return;
            enabled = on;
            if (on && matrixLength() > 0) {
                connect();
            } else {
                release();
            }
        });
    }

    static void onState(Context context, float[] nextPeaks, long duration, long position, boolean isPlaying) {
        MAIN.post(() -> {
            app = context.getApplicationContext();
            hasTrack = true;
            if (nextPeaks != null && nextPeaks.length > 0) peaks = nextPeaks;
            durationMs = duration;
            positionMs = position;
            playing = isPlaying;
            stamp = SystemClock.elapsedRealtime();
            if (enabled) {
                lastFrame = null;
                tick();
            }
        });
    }

    static void onStop() {
        MAIN.post(() -> {
            hasTrack = false;
            peaks = null;
            playing = false;
            MAIN.removeCallbacks(ticker);
            close();
        });
    }

    private static void connect() {
        if (connected || connecting || app == null) return;
        try {
            manager = GlyphMatrixManager.getInstance(app);
            connecting = true;
            manager.init(new GlyphMatrixManager.Callback() {
                @Override
                public void onServiceConnected(ComponentName name) {
                    MAIN.post(() -> {
                        connecting = false;
                        try {
                            manager.register(deviceId());
                            connected = true;
                            lastFrame = null;
                            tick();
                        } catch (Throwable failed) {
                            connected = false;
                        }
                    });
                }

                @Override
                public void onServiceDisconnected(ComponentName name) {
                    MAIN.post(() -> {
                        connected = false;
                        connecting = false;
                        shown = false;
                        MAIN.removeCallbacks(ticker);
                    });
                }
            });
        } catch (Throwable failed) {
            connecting = false;
        }
    }

    private static void release() {
        MAIN.removeCallbacks(ticker);
        close();
        try {
            if (manager != null && (connected || connecting)) manager.unInit();
        } catch (Throwable ignored) {
            // The service was already gone.
        }
        connected = false;
        connecting = false;
    }

    private static void close() {
        if (!connected || manager == null || !shown) return;
        try {
            manager.closeAppMatrix();
        } catch (Throwable ignored) {
            // Nothing to close.
        }
        shown = false;
        lastFrame = null;
    }

    private static final Runnable ticker = GlyphWaveform::tick;

    private static void tick() {
        MAIN.removeCallbacks(ticker);
        if (!enabled || !connected || !hasTrack || manager == null) return;
        int length = matrixLength();
        if (length <= 0) return;
        long position = positionMs + (playing ? SystemClock.elapsedRealtime() - stamp : 0);
        double progress = durationMs > 0 ? (double) position / durationMs : 0;
        boolean blinkOn = (SystemClock.elapsedRealtime() / 500) % 2 == 0;
        int[] frame = WaveformFrame.render(peaks, progress, length, playing, blinkOn);
        if (lastFrame == null || !Arrays.equals(frame, lastFrame)) {
            try {
                manager.setAppMatrixFrame(frame);
                lastFrame = frame;
                shown = true;
            } catch (Throwable failed) {
                lastFrame = null;
            }
        }
        if (playing) MAIN.postDelayed(ticker, TICK_MS);
    }
}
