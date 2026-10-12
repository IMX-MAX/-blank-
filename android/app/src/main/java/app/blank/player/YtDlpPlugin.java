package app.blank.player;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

import kotlin.Unit;

/**
 * yt-dlp running inside the app, for adding songs from YouTube Music. The web side decides what to ask for
 * (see `src/lib/ytdlp.ts`); this only runs it, keeps the downloaded files in the cache until released, and
 * keeps yt-dlp itself fresh because YouTube changes often.
 */
@CapacitorPlugin(name = "YtDlp")
public class YtDlpPlugin extends Plugin {
    private static final String PROCESS_ID = "blank-ytdlp";
    private static final long UPDATE_EVERY_MS = 24L * 60 * 60 * 1000;
    private static final Pattern TOKEN = Pattern.compile("^[a-f0-9]{32}$");

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean ready;

    private File root() {
        return new File(getContext().getCacheDir(), "ytdlp");
    }

    private synchronized void ensureReady() throws Exception {
        if (ready) return;
        YoutubeDL.getInstance().init(getContext());
        SharedPreferences prefs = getContext().getSharedPreferences("ytdlp", Context.MODE_PRIVATE);
        long last = prefs.getLong("updated", 0);
        if (System.currentTimeMillis() - last > UPDATE_EVERY_MS) {
            try {
                YoutubeDL.getInstance().updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel._STABLE);
                prefs.edit().putLong("updated", System.currentTimeMillis()).apply();
            } catch (Exception ignored) {
                // Offline or GitHub unreachable: the copy that came with the app still works for a while.
            }
        }
        File[] stale = root().listFiles();
        if (stale != null) {
            for (File old : stale) {
                if (System.currentTimeMillis() - old.lastModified() > 60L * 60 * 1000) deleteTree(old);
            }
        }
        ready = true;
    }

    private static List<String> strings(JSArray array) throws Exception {
        List<String> out = new ArrayList<>();
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    private static String message(Throwable error) {
        String text = error.getMessage();
        if (text == null || text.trim().isEmpty()) return "yt-dlp failed";
        String[] lines = text.trim().split("\\r?\\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String line = lines[i].trim();
            if (line.startsWith("ERROR:")) return line.substring(6).trim();
        }
        String last = lines[lines.length - 1].trim();
        return last.length() > 300 ? last.substring(0, 300) : last;
    }

    @PluginMethod
    public void status(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureReady();
                String version = YoutubeDL.getInstance().versionName(getContext());
                JSObject result = new JSObject();
                result.put("version", version == null ? "bundled" : version);
                call.resolve(result);
            } catch (Throwable error) {
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void info(PluginCall call) {
        String target = call.getString("target");
        if (target == null || target.isEmpty()) {
            call.reject("Nothing to look up");
            return;
        }
        worker.execute(() -> {
            try {
                ensureReady();
                YoutubeDLRequest request = new YoutubeDLRequest(Collections.singletonList(target));
                request.addCommands(strings(call.getArray("args")));
                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, PROCESS_ID, (progress, eta, line) -> Unit.INSTANCE);
                JSObject result = new JSObject();
                result.put("json", response.getOut());
                call.resolve(result);
            } catch (Throwable error) {
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Only YouTube and YouTube Music links work here");
            return;
        }
        worker.execute(() -> {
            String token = UUID.randomUUID().toString().replace("-", "");
            File dir = new File(root(), token);
            try {
                ensureReady();
                if (!dir.mkdirs()) throw new IllegalStateException("Could not create a folder for the download");
                YoutubeDLRequest request = new YoutubeDLRequest(Collections.singletonList(url));
                request.addCommands(strings(call.getArray("args")));
                request.addOption("-P", dir.getAbsolutePath());
                YoutubeDL.getInstance().execute(request, PROCESS_ID, (progress, eta, line) -> {
                    JSObject event = new JSObject();
                    event.put("value", Math.max(0, Math.min(1, progress / 100f)));
                    notifyListeners("progress", event);
                    return Unit.INSTANCE;
                });
                File audio = null;
                File cover = null;
                File info = null;
                File[] files = dir.listFiles();
                if (files != null) {
                    for (File file : files) {
                        String name = file.getName().toLowerCase(Locale.ROOT);
                        if (name.endsWith(".info.json")) info = file;
                        else if (name.matches(".*\\.(jpe?g|png|webp)$")) cover = file;
                        else if (!name.endsWith(".json") && !name.endsWith(".part") && !name.endsWith(".ytdl")) audio = file;
                    }
                }
                if (audio == null) throw new IllegalStateException("yt-dlp did not save any audio");
                JSObject result = new JSObject();
                result.put("token", token);
                result.put("audioPath", audio.getAbsolutePath());
                if (cover != null) result.put("coverPath", cover.getAbsolutePath());
                if (info != null) result.put("infoPath", info.getAbsolutePath());
                call.resolve(result);
            } catch (Throwable error) {
                deleteTree(dir);
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        String token = call.getString("token");
        if (token != null && TOKEN.matcher(token).matches()) deleteTree(new File(root(), token));
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        YoutubeDL.getInstance().destroyProcessById(PROCESS_ID);
        call.resolve();
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdownNow();
    }
}
