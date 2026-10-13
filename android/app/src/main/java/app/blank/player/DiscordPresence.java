package app.blank.player;

import android.os.Handler;
import android.os.Looper;

import java.nio.charset.StandardCharsets;

/**
 * Shows what is playing as "Listening to [blank]" in the Discord app on the same phone.
 *
 * It talks to Discord through the Discord Social SDK (unauthenticated Rich Presence over the local Discord app), which
 * Discord does not let us redistribute. The native half (libblank_discord.so) is only built when
 * android/app/libs/discord_partner_sdk.aar exists; without it this class quietly does nothing.
 */
final class DiscordPresence {
    /** The [blank] application on the Discord developer portal. */
    static final long APPLICATION_ID = 1559359875199533116L;

    private static final long DEBOUNCE_MS = 1000;
    private static final long DRIFT_SECONDS = 3;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static boolean loaded;
    private static boolean available;
    private static boolean started;
    private static boolean enabled;

    private static PlaybackService.State latest;
    private static long latestAt;
    private static boolean shown;
    private static String shownTrack = "";
    private static long shownStart;

    private DiscordPresence() {}

    private static native void nativeStart(long applicationId);

    private static native void nativeUpdate(byte[] details, byte[] state, byte[] album, long startSeconds, long endSeconds);

    private static native void nativeClear();

    static synchronized boolean isAvailable() {
        if (!loaded) {
            loaded = true;
            try {
                System.loadLibrary("blank_discord");
                available = true;
            } catch (UnsatisfiedLinkError | SecurityException missing) {
                available = false;
            }
        }
        return available;
    }

    static void setEnabled(boolean on) {
        MAIN.post(() -> {
            enabled = on;
            if (!on) {
                MAIN.removeCallbacks(flush);
                clear();
            } else if (latest != null) {
                scheduleFlush();
            }
        });
    }

    /** Called with every playback state the service applies. */
    static void onState(PlaybackService.State state) {
        MAIN.post(() -> {
            latest = state;
            latestAt = System.currentTimeMillis();
            if (enabled) scheduleFlush();
        });
    }

    static void onStopped() {
        MAIN.post(() -> {
            latest = null;
            MAIN.removeCallbacks(flush);
            clear();
        });
    }

    private static void scheduleFlush() {
        MAIN.removeCallbacks(flush);
        MAIN.postDelayed(flush, DEBOUNCE_MS);
    }

    private static final Runnable flush = new Runnable() {
        @Override
        public void run() {
            PlaybackService.State state = latest;
            if (!enabled || state == null || !isAvailable()) return;
            if (!state.playing || state.title == null || state.title.isEmpty()) {
                clear();
                return;
            }
            long now = System.currentTimeMillis();
            long position = Math.max(0, state.positionMs) + Math.max(0, now - latestAt);
            long startSeconds = (now - position) / 1000;
            long endSeconds = state.durationMs > 0 ? startSeconds + state.durationMs / 1000 : 0;
            String track = state.trackId != null ? state.trackId : state.title + "\n" + state.artist;
            if (shown && track.equals(shownTrack) && Math.abs(startSeconds - shownStart) <= DRIFT_SECONDS) return;
            try {
                if (!started) {
                    nativeStart(APPLICATION_ID);
                    started = true;
                }
                nativeUpdate(bytes(state.title), bytes(state.artist), bytes(state.album), startSeconds, endSeconds);
                shown = true;
                shownTrack = track;
                shownStart = startSeconds;
            } catch (UnsatisfiedLinkError | RuntimeException failed) {
                available = false;
            }
        }
    };

    private static void clear() {
        if (!shown) return;
        shown = false;
        shownTrack = "";
        if (!isAvailable() || !started) return;
        try {
            nativeClear();
        } catch (UnsatisfiedLinkError | RuntimeException ignored) {
            // The next update starts from scratch.
        }
    }

    /** Discord wants 2 to 128 characters for each line. */
    private static byte[] bytes(String text) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) return new byte[0];
        if (value.codePointCount(0, value.length()) > 128) {
            value = value.substring(0, value.offsetByCodePoints(0, 127)) + "\u2026";
        }
        if (value.codePointCount(0, value.length()) < 2) value = value + "\u2800";
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
