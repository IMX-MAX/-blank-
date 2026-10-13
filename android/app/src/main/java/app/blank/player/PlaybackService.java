package app.blank.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

/**
 * Owns the system media session. This is what puts the now-playing card on the lock screen and in the
 * notification shade, and keeps the process alive while music plays with the screen off.
 */
public class PlaybackService extends Service {

    public interface Listener {
        void onAction(String action, long positionMs);
    }

    public static final class State {
        public String title = "";
        public String artist = "";
        public String album = "";
        public long durationMs;
        public long positionMs;
        public boolean playing;
        public Bitmap artwork;
        public boolean keepArtwork;
        public float[] peaks;
        public String trackId;
        public boolean shuffle;
        /** Waveform for the home screen widget, which wants it whether or not the Glyph waveform is on. */
        public float[] widgetPeaks;
    }

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 7;
    private static final String ACTION_PLAY = "app.blank.player.PLAY";
    private static final String ACTION_PAUSE = "app.blank.player.PAUSE";
    private static final String ACTION_NEXT = "app.blank.player.NEXT";
    private static final String ACTION_PREVIOUS = "app.blank.player.PREVIOUS";
    private static final String ACTION_STOP = "app.blank.player.STOP";

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static PlaybackService instance;
    private static State pending;
    private static Listener listener;

    private MediaSession session;
    private NotificationManager notifications;
    private Bitmap artwork;
    private Bitmap fallbackArt;
    private boolean foreground;
    private PowerManager.WakeLock wakeLock;

    public static void setListener(Listener next) {
        listener = next;
    }

    /** Whether a playback session is alive, so the widget's buttons have something to talk to. */
    public static boolean isRunning() {
        return instance != null && instance.session != null;
    }

    /** A control pressed on the home screen widget, handled like one from the notification. */
    public static void dispatch(String action) {
        MAIN.post(() -> emit(action, 0));
    }

    public static void update(Context context, State state) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            MAIN.post(() -> update(context, state));
            return;
        }
        if (instance != null && instance.session != null) {
            instance.apply(state);
            return;
        }
        pending = state;
        Intent intent = new Intent(context, PlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException ignored) {
            // The app was not allowed to start a foreground service right now; the next update retries.
            pending = null;
        }
    }

    public static void stop(Context context) {
        MAIN.post(() -> {
            pending = null;
            if (instance != null) instance.shutdown();
        });
    }

    private static void emit(String action, long positionMs) {
        if (listener != null) listener.onAction(action, positionMs);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notifications = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Now playing", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            notifications.createNotificationChannel(channel);
        }
        session = new MediaSession(this, "blank");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { emit("play", 0); }
            @Override public void onPause() { emit("pause", 0); }
            @Override public void onSkipToNext() { emit("next", 0); }
            @Override public void onSkipToPrevious() { emit("previous", 0); }
            @Override public void onSeekTo(long pos) { emit("seekto", pos); }
            @Override public void onStop() { emit("pause", 0); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action != null) {
            switch (action) {
                case ACTION_PLAY: emit("play", 0); break;
                case ACTION_PAUSE: emit("pause", 0); break;
                case ACTION_NEXT: emit("next", 0); break;
                case ACTION_PREVIOUS: emit("previous", 0); break;
                case ACTION_STOP: emit("pause", 0); shutdown(); break;
                default: break;
            }
            return START_NOT_STICKY;
        }
        State state = pending;
        pending = null;
        if (state != null) {
            apply(state);
        } else if (!foreground) {
            // startForegroundService() obliges us to post a notification before stopping again.
            try {
                startForeground(NOTIFICATION_ID, placeholder());
            } catch (RuntimeException ignored) {
                // Not allowed to run in the foreground right now; stopping is all that is left.
            }
            shutdown();
        }
        return START_NOT_STICKY;
    }

    private Notification placeholder() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_stat_music).setContentTitle("[blank]").build();
    }

    private void apply(State state) {
        if (session == null) return;
        MAIN.removeCallbacks(demote);
        if (state.artwork != null) artwork = BracketArt.frame(state.artwork);
        else if (!state.keepArtwork) artwork = null;
        if (artwork == null && fallbackArt == null) fallbackArt = BracketArt.placeholder();
        Bitmap shown = artwork != null ? artwork : fallbackArt;

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, state.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, state.album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs);
        metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, shown);
        metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, shown);
        session.setMetadata(metadata.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(state.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                Math.max(0, state.positionMs), state.playing ? 1f : 0f, SystemClock.elapsedRealtime())
            .build());

        holdWakeLock(state.playing);
        NowPlayingWidget.onState(getApplicationContext(), state);
        DiscordPresence.onState(state);
        MAIN.removeCallbacks(widgetTick);
        if (state.playing) MAIN.postDelayed(widgetTick, WIDGET_TICK_MS);
        LiveVisuals.onState(this, state.trackId, state.peaks, state.durationMs, state.positionMs, state.playing);
        Notification notification = buildNotification(state, shown);
        if (!foreground) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                foreground = true;
            } catch (RuntimeException blocked) {
                // Android refuses to promote a service while the app is in the background; the session still works.
                notifications.notify(NOTIFICATION_ID, notification);
            }
        } else {
            notifications.notify(NOTIFICATION_ID, notification);
        }
        if (!state.playing) {
            // Paused: after a moment let the card be swiped away. The delay keeps a song change from dropping foreground state.
            MAIN.postDelayed(demote, 5000);
        }
    }

    private static final long WIDGET_TICK_MS = 2000;

    private final Runnable widgetTick = new Runnable() {
        @Override
        public void run() {
            NowPlayingWidget.tick(getApplicationContext());
            MAIN.postDelayed(this, WIDGET_TICK_MS);
        }
    };

    private final Runnable demote = new Runnable() {
        @Override
        public void run() {
            if (!foreground) return;
            stopForeground(false);
            foreground = false;
        }
    };

    private void holdWakeLock(boolean hold) {
        if (hold) {
            if (wakeLock == null) {
                PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "blank:playback");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
        } else if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private Notification buildNotification(State state, Bitmap shown) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(state.title)
            .setContentText(state.album == null || state.album.isEmpty() ? state.artist : state.artist + " \u00b7 " + state.album)
            .setSubText("[blank]")
            .setColor(0xFFE6C84A)
            .setContentIntent(contentIntent)
            .setDeleteIntent(servicePending(ACTION_STOP))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(state.playing);
        builder.setLargeIcon(shown);

        builder.addAction(action(R.drawable.ic_skip_previous, "Previous", ACTION_PREVIOUS));
        builder.addAction(state.playing
            ? action(R.drawable.ic_pause, "Pause", ACTION_PAUSE)
            : action(R.drawable.ic_play, "Play", ACTION_PLAY));
        builder.addAction(action(R.drawable.ic_skip_next, "Next", ACTION_NEXT));
        builder.setStyle(new Notification.MediaStyle()
            .setMediaSession(session.getSessionToken())
            .setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private Notification.Action action(int icon, String title, String name) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), title, servicePending(name)).build();
    }

    private PendingIntent servicePending(String name) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(name);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        return Build.VERSION.SDK_INT >= 26
            ? PendingIntent.getForegroundService(this, name.hashCode(), intent, flags)
            : PendingIntent.getService(this, name.hashCode(), intent, flags);
    }

    private void shutdown() {
        MAIN.removeCallbacks(demote);
        MAIN.removeCallbacks(widgetTick);
        instance = null;
        NowPlayingWidget.onStopped(getApplicationContext());
        DiscordPresence.onStopped();
        LiveVisuals.onStop();
        holdWakeLock(false);
        foreground = false;
        stopForeground(true);
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        instance = null;
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        holdWakeLock(false);
        MAIN.removeCallbacks(widgetTick);
        if (instance == this) {
            instance = null;
            NowPlayingWidget.onStopped(getApplicationContext());
        }
        if (session != null) {
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Artwork wrapped in the [ ] brand marks, so the lock screen and shade card look like the app. */
    private static final class BracketArt {
        private static final int SIZE = 512;
        private static final int GOLD = 0xFFE6C84A;

        static Bitmap frame(Bitmap source) {
            Bitmap out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            int side = Math.min(source.getWidth(), source.getHeight());
            android.graphics.Rect from = new android.graphics.Rect(
                (source.getWidth() - side) / 2, (source.getHeight() - side) / 2,
                (source.getWidth() + side) / 2, (source.getHeight() + side) / 2);
            Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(source, from, new RectF(0, 0, SIZE, SIZE), bitmapPaint);

            Paint shade = new Paint();
            shade.setShader(new LinearGradient(0, 0, 0, SIZE,
                new int[] {0x33000000, 0x00000000, 0x66000000}, new float[] {0f, 0.5f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, SIZE, SIZE, shade);

            drawBrackets(canvas, Color.WHITE, 0.62f, true);
            return out;
        }

        static Bitmap placeholder() {
            Bitmap out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            Paint bg = new Paint();
            bg.setShader(new LinearGradient(0, 0, SIZE, SIZE, 0xFF2B2B2B, 0xFF0E0E0E, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, SIZE, SIZE, bg);
            drawBrackets(canvas, GOLD, 0.5f, false);
            return out;
        }

        private static void drawBrackets(Canvas canvas, int color, float heightRatio, boolean shadow) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(SIZE * 0.04f);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setColor(color);
            if (shadow) paint.setShadowLayer(SIZE * 0.03f, 0, SIZE * 0.008f, 0x99000000);
            float h = SIZE * heightRatio;
            float top = (SIZE - h) / 2f;
            float bottom = top + h;
            float arm = SIZE * 0.1f;
            float inset = shadow ? SIZE * 0.07f : SIZE * 0.2f;
            Path left = new Path();
            left.moveTo(inset + arm, top);
            left.lineTo(inset, top);
            left.lineTo(inset, bottom);
            left.lineTo(inset + arm, bottom);
            Path right = new Path();
            right.moveTo(SIZE - inset - arm, top);
            right.lineTo(SIZE - inset, top);
            right.lineTo(SIZE - inset, bottom);
            right.lineTo(SIZE - inset - arm, bottom);
            canvas.drawPath(left, paint);
            canvas.drawPath(right, paint);
        }
    }
}
