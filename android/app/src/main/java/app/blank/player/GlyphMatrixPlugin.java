package app.blank.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GlyphMatrix")
public class GlyphMatrixPlugin extends Plugin {
    @PluginMethod
    public void isSupported(PluginCall call) {
        int length = GlyphWaveform.matrixLength();
        JSObject result = new JSObject();
        result.put("supported", length > 0);
        result.put("length", length);
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        GlyphWaveform.setEnabled(getContext().getApplicationContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }
}
