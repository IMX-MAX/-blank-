package app.blank.player;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaControlsPlugin.class);
        registerPlugin(GlyphMatrixPlugin.class);
        registerPlugin(DiscordPlugin.class);
        super.onCreate(savedInstanceState);
        attachDiscordSdk();
        // Sign-in lives on another origin, so its session cookie is a third-party cookie to the app.
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(getBridge().getWebView(), true);
    }

    /** The Discord SDK needs an activity to talk to the Discord app; it is only in the build when its .aar is. */
    private void attachDiscordSdk() {
        try {
            Class.forName("com.discord.socialsdk.DiscordSocialSdkInit").getMethod("setEngineActivity", android.app.Activity.class).invoke(null, this);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Built without the Discord SDK.
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }
}
