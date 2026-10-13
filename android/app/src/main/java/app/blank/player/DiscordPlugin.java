package app.blank.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DiscordPresence")
public class DiscordPlugin extends Plugin {
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", DiscordPresence.isAvailable());
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        DiscordPresence.setEnabled(Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }
}
