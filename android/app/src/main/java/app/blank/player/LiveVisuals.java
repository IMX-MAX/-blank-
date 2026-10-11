package app.blank.player;

import android.content.ComponentName;
import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.nothing.ketchum.Common;
import com.nothing.ketchum.Glyph;
import com.nothing.ketchum.GlyphMatrixManager;

import java.util.Arrays;

/**
 * Draws the live visuals on the Glyph Matrix on the back of supported Nothing phones (a scrolling waveform,
 * the line of lyrics that is playing, or a flash and ripple on every beat), and vibrates the phone to the beat.
 * Everything runs on the main thread, and position is extrapolated here so the display keeps moving
 * while the web view is throttled with the screen off.
 */
final class LiveVisuals {
    static final String WAVEFORM = "waveform";
    static final String LYRICS = "lyrics";
    static final String PULSE = "pulse";

    private static final long WAVEFORM_TICK_MS = 250;
    private static final long LYRICS_TICK_MS = 70;
    private static final long PULSE_TICK_MS = 45;
    private static final float MIN_VIBRATE_STRENGTH = 0.2f;
    private static final long MIN_VIBRATE_GAP_MS = 140;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static boolean enabled;
    private static String mode = WAVEFORM;
    private static boolean vibrate;
    private static boolean connected;
    private static boolean connecting;
    private static GlyphMatrixManager manager;
    private static Context app;

    private static boolean hasTrack;
    private static String trackId;
    private static float[] peaks;
    private static long durationMs;
    private static long positionMs;
    private static boolean playing;
    private static long stamp;
    private static int[] lastFrame;
    private static boolean shown;

    private static String dataTrackId;
    private static double[] lineStarts = new double[0];
    private static double[] lineEnds = new double[0];
    private static String[] lineTexts = new String[0];
    private static BeatTrack beats;
    private static int laidOutLine = -1;
    private static int[] laidOutColumns = new int[0];
    private static GlyphRaster raster;

    private static Vibrator vibrator;
    private static long lastVibrateAt;

    private LiveVisuals() {}

    /** The matrix side length of this phone, or 0 when it has no Glyph Matrix this app can drive. */
    static int matrixLength() {
        if (Build.VERSION.SDK_INT < 33 || !"nothing".equalsIgnoreCase(Build.MANUFACTURER)) return 0;
        try {
            return Common.getDeviceMatrixLength();
        } catch (Throwable unavailable) {
            return 0;
        }
    }

    static boolean hasVibrator(Context context) {
        Vibrator motor = vibratorOf(context);
        return motor != null && motor.hasVibrator();
    }

    private static Vibrator vibratorOf(Context context) {
        if (vibrator == null) vibrator = (Vibrator) context.getApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
        return vibrator;
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

    static void setMode(String next) {
        MAIN.post(() -> {
            String value = LYRICS.equals(next) || PULSE.equals(next) ? next : WAVEFORM;
            if (value.equals(mode)) return;
            mode = value;
            lastFrame = null;
            tick();
        });
    }

    static void setVibrate(Context context, boolean on) {
        MAIN.post(() -> {
            app = context.getApplicationContext();
            vibrate = on;
            scheduleVibration();
        });
    }

    /** The lyric lines (parallel arrays, seconds) and beats for a song. A null argument leaves what was there. */
    static void setTrackData(String id, double[] starts, double[] ends, String[] texts, float[] beatTimes, float[] beatStrengths) {
        MAIN.post(() -> {
            if (id == null || !id.equals(dataTrackId)) clearData(id);
            if (starts != null) {
                lineStarts = starts;
                lineEnds = ends;
                lineTexts = texts;
                laidOutLine = -1;
            }
            if (beatTimes != null) beats = new BeatTrack(beatTimes, beatStrengths);
            lastFrame = null;
            tick();
            scheduleVibration();
        });
    }

    private static void clearData(String id) {
        dataTrackId = id;
        lineStarts = new double[0];
        lineEnds = new double[0];
        lineTexts = new String[0];
        beats = null;
        laidOutLine = -1;
    }

    static void onState(Context context, String id, float[] nextPeaks, long duration, long position, boolean isPlaying) {
        MAIN.post(() -> {
            app = context.getApplicationContext();
            hasTrack = true;
            if (id != null && !id.equals(dataTrackId)) clearData(id);
            trackId = id;
            if (nextPeaks != null && nextPeaks.length > 0) peaks = nextPeaks;
            durationMs = duration;
            positionMs = position;
            playing = isPlaying;
            stamp = SystemClock.elapsedRealtime();
            lastFrame = null;
            tick();
            scheduleVibration();
        });
    }

    static void onStop() {
        MAIN.post(() -> {
            hasTrack = false;
            peaks = null;
            playing = false;
            clearData(null);
            MAIN.removeCallbacks(ticker);
            MAIN.removeCallbacks(buzz);
            close();
        });
    }

    private static double seconds() {
        long position = positionMs + (playing ? SystemClock.elapsedRealtime() - stamp : 0);
        return position / 1000.0;
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

    private static final Runnable ticker = LiveVisuals::tick;

    /** What to draw, and how soon to draw it again. Lyrics and pulse fall back to the waveform until their data arrives. */
    private static long draw(int length, double now, int[][] out) {
        if (LYRICS.equals(mode) && lineStarts.length > 0) {
            int line = LyricsFrame.lineAt(lineStarts, lineEnds, now);
            if (line < 0) {
                out[0] = new int[length * length];
            } else {
                if (line != laidOutLine) {
                    if (raster == null) raster = new GlyphRaster();
                    laidOutColumns = LyricsFrame.layout(lineTexts[line], raster);
                    laidOutLine = line;
                }
                double start = lineStarts[line];
                double span = LyricsFrame.endOf(lineStarts, lineEnds, line) - start;
                out[0] = LyricsFrame.render(laidOutColumns, span > 0 ? (now - start) / span : 0, length);
            }
            return LYRICS_TICK_MS;
        }
        if (PULSE.equals(mode) && beats != null && beats.size() > 0) {
            out[0] = PulseFrame.render(beats, now, length);
            return PULSE_TICK_MS;
        }
        double progress = durationMs > 0 ? now * 1000 / durationMs : 0;
        boolean blinkOn = (SystemClock.elapsedRealtime() / 500) % 2 == 0;
        out[0] = WaveformFrame.render(peaks, progress, length, playing, blinkOn);
        return WAVEFORM_TICK_MS;
    }

    private static void tick() {
        MAIN.removeCallbacks(ticker);
        if (!enabled || !connected || !hasTrack || manager == null) return;
        int length = matrixLength();
        if (length <= 0) return;
        int[][] out = new int[1][];
        long next = draw(length, seconds(), out);
        int[] frame = out[0];
        if (lastFrame == null || !Arrays.equals(frame, lastFrame)) {
            try {
                manager.setAppMatrixFrame(frame);
                lastFrame = frame;
                shown = true;
            } catch (Throwable failed) {
                lastFrame = null;
            }
        }
        if (playing) MAIN.postDelayed(ticker, next);
    }

    private static final Runnable buzz = LiveVisuals::buzzOnBeat;

    /** Arms a timer for the next beat that is strong enough to feel. Called whenever the clock or the beats change. */
    private static void scheduleVibration() {
        MAIN.removeCallbacks(buzz);
        if (!vibrate || !playing || !hasTrack || beats == null || app == null) return;
        int next = beats.nextAfter(seconds() - 0.005, MIN_VIBRATE_STRENGTH);
        if (next < 0) return;
        long wait = Math.max(0, Math.round((beats.time(next) - seconds()) * 1000));
        MAIN.postDelayed(buzz, wait);
    }

    private static void buzzOnBeat() {
        if (!vibrate || !playing || beats == null || app == null) return;
        double now = seconds();
        int index = beats.indexAt(now + 0.03);
        if (index >= 0 && beats.strength(index) >= MIN_VIBRATE_STRENGTH) {
            long clock = SystemClock.elapsedRealtime();
            if (clock - lastVibrateAt >= MIN_VIBRATE_GAP_MS) {
                lastVibrateAt = clock;
                pulse(beats.strength(index));
            }
        }
        int next = beats.nextAfter(now + 0.03, MIN_VIBRATE_STRENGTH);
        if (next < 0) return;
        long wait = Math.max(MIN_VIBRATE_GAP_MS / 2, Math.round((beats.time(next) - now) * 1000));
        MAIN.postDelayed(buzz, wait);
    }

    private static void pulse(float strength) {
        Vibrator motor = vibratorOf(app);
        if (motor == null || !motor.hasVibrator()) return;
        long length = Math.round(18 + 22 * strength);
        int amplitude = Math.round(80 + 175 * strength);
        try {
            AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build();
            motor.vibrate(VibrationEffect.createOneShot(length, amplitude), attributes);
        } catch (Throwable ignored) {
            // Vibration is a nicety.
        }
    }
}
