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
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
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
    }

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 7;
    private static final String ACTION_PLAY = "app.blank.player.PLAY";
    private static final String ACTION_PAUSE = "app.blank.player.PAUSE";
    private static final String ACTION_NEXT = "app.blank.player.NEXT";
    private static final String ACTION_PREVIOUS = "app.blank.player.PREVIOUS";
    private static final String ACTION_STOP = "app.blank.player.STOP";

    private static PlaybackService instance;
    private static State pending;
    private static Listener listener;

    private MediaSession session;
    private NotificationManager notifications;
    private Bitmap artwork;
    private boolean foreground;
    private PowerManager.WakeLock wakeLock;

    public static void setListener(Listener next) {
        listener = next;
    }

    public static void update(Context context, State state) {
        if (instance != null) {
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
        pending = null;
        if (instance != null) instance.shutdown();
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
            shutdown();
        }
        return START_NOT_STICKY;
    }

    private void apply(State state) {
        if (state.artwork != null) artwork = state.artwork;
        else if (!state.keepArtwork) artwork = null;

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, state.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, state.album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs);
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
        }
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
        Notification notification = buildNotification(state);
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foreground = true;
        } else {
            notifications.notify(NOTIFICATION_ID, notification);
        }
        if (!state.playing) {
            // Paused: let the card be swiped away, but keep the session so the lock screen can resume.
            stopForeground(false);
            foreground = false;
        }
    }

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

    private Notification buildNotification(State state) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(state.title)
            .setContentText(state.artist)
            .setSubText(state.album)
            .setContentIntent(contentIntent)
            .setDeleteIntent(servicePending(ACTION_STOP))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(state.playing);
        if (artwork != null) builder.setLargeIcon(artwork);

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
        if (instance == this) instance = null;
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
}
