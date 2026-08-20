package com.udd.mtgcompanion;

import android.os.Bundle;
import android.webkit.WebSettings;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // theme/variables.css's "Force Dark Mode / Medieval Mode Everywhere"
        // block hardcodes every color unconditionally — there is no
        // @media (prefers-color-scheme: light) branch anywhere, the app is
        // ALWAYS dark. index.html's <meta name="color-scheme" content="dark">
        // is supposed to be enough on its own for the WebView to opt the
        // page out of its own algorithmic dark-theming pass, but live-tested
        // on a real device that alone was NOT reliable enough — the spin
        // wheel's conic-gradient (SpinWheelModal.tsx) still came out visibly
        // recolored (two of its three distinct wedge colors collapsing to
        // look the same). This is the actual native setting the WebView's
        // heuristic sits behind — WebSettingsCompat.setAlgorithmicDarkeningAllowed
        // is the modern replacement for the old setForceDark() API — calling
        // it directly removes any dependency on the WebView correctly
        // inferring intent from a meta tag it may or may not honor.
        // Feature-checked since not every WebView version on real devices
        // supports it (falls back to a silent no-op, same as before this
        // fix, rather than crashing on unsupported devices).
        WebSettings settings = this.bridge.getWebView().getSettings();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }
    }
}
