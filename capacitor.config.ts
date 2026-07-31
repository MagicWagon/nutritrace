import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nutritrace.app',
  appName: 'NutriTrace',
  webDir: 'dist',
  // In dev, point to your local Vite dev server for live-reload on device
  // Uncomment and set your machine's LAN IP when doing native dev builds:
  // server: { url: 'http://192.168.1.x:5173', cleartext: true },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  server: {
    // WebView identity for Android autofill. Without an explicit hostname
    // Capacitor serves from https://localhost/, which is what password
    // managers like Bitwarden read as the site name — so saved
    // credentials show up as "localhost". Setting a hostname makes the
    // WebView report https://app.nutritrace.local/ instead, which reads
    // as a real app identifier.
    //
    // .local is the RFC 6762 TLD reserved for local/private use — nobody
    // can register it, no collision risk. If we ever buy a real domain
    // we can swap this for it in a future release and add Digital Asset
    // Links to associate saved web credentials with the app.
    //
    // ONE-TIME UPGRADE COST: changing the hostname changes the WebView's
    // origin, which orphans localStorage / sessionStorage / IndexedDB /
    // cookies tied to the old localhost origin. SQLite via
    // @capacitor-community/sqlite lives in the app data directory and is
    // origin-independent — food/meal/diary data is safe. Users on a
    // linked server will need to re-enter their server URL + credentials
    // once; native-standalone users will see their theme / prefs default
    // once. Called out in the CHANGELOG.
    hostname: 'app.nutritrace.local',
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0A0B0F',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'native',
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0A0B0F',
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};

export default config;
