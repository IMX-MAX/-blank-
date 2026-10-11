package app.blank.player;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "GlyphMatrix")
public class GlyphMatrixPlugin extends Plugin {
    @PluginMethod
    public void isSupported(PluginCall call) {
        int length = LiveVisuals.matrixLength();
        JSObject result = new JSObject();
        result.put("supported", length > 0);
        result.put("length", length);
        result.put("vibrator", LiveVisuals.hasVibrator(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        LiveVisuals.setEnabled(getContext().getApplicationContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    @PluginMethod
    public void setMode(PluginCall call) {
        LiveVisuals.setMode(call.getString("mode", LiveVisuals.WAVEFORM));
        call.resolve();
    }

    @PluginMethod
    public void setVibrate(PluginCall call) {
        LiveVisuals.setVibrate(getContext().getApplicationContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    @PluginMethod
    public void setTrackData(PluginCall call) {
        String trackId = call.getString("trackId");
        double[] starts = null;
        double[] ends = null;
        String[] texts = null;
        JSArray lines = call.getArray("lines");
        if (lines != null) {
            starts = new double[lines.length()];
            ends = new double[lines.length()];
            texts = new String[lines.length()];
            for (int i = 0; i < starts.length; i++) {
                JSONObject line = lines.optJSONObject(i);
                starts[i] = line == null ? 0 : line.optDouble("start", 0);
                ends[i] = line == null ? 0 : line.optDouble("end", 0);
                texts[i] = line == null ? "" : line.optString("text", "");
            }
        }
        LiveVisuals.setTrackData(trackId, starts, ends, texts, floats(call.getArray("beatTimes")), floats(call.getArray("beatStrengths")));
        call.resolve();
    }

    private static float[] floats(JSArray array) {
        if (array == null) return null;
        float[] values = new float[array.length()];
        for (int i = 0; i < values.length; i++) values[i] = (float) array.optDouble(i, 0);
        return values;
    }
}
