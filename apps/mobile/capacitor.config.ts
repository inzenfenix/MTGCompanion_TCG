import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.udd.mtgcompanion',
  appName: 'MTG Companion',
  webDir: 'dist',
  // Capacitor defaults to serving the app itself over https://localhost —
  // fine normally, but ROADMAP.md workstream I's backend is plain HTTP (no
  // domain/TLS in the v1 infra plan). A page served over https fetching an
  // http:// resource is "mixed content", which Android's WebView blocks by
  // default REGARDLESS of network_security_config.xml's cleartext
  // exception — that config only permits the OS-level connection, mixed-
  // content policy is a separate WebView-level restriction on top of it.
  // Matching both schemes to http sidesteps the whole mixed-content check.
  // Confirmed as the real root cause of a live "can't login" bug: the
  // phone's browser could load the backend's bare `http://` root fine (a
  // top-level navigation, not subject to mixed-content), but the app's own
  // fetch() calls failed silently (a network TypeError, not a real HTTP
  // response) until this was set.
  server: {
    androidScheme: 'http',
  },
};

export default config;
