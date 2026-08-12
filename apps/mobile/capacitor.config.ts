import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native app ships the web build verbatim.
 *
 * That is the point: "the app has the exact same classic mode" is guaranteed by
 * there being one implementation, not maintained by keeping two in step. The
 * only differences are the ones a native shell can actually add — haptics, a
 * status bar, deep-linked invites, and an icon on the home screen.
 */
const config: CapacitorConfig = {
  appId: 'com.blokduo.game',
  appName: 'BLOKDUO',
  webDir: '../web/dist',

  // The game is portrait, and the board is sized off the short edge.
  android: {
    backgroundColor: '#0b1020',
  },
  ios: {
    backgroundColor: '#0b1020',
    // The board draws right up to the edges; safe areas are handled in CSS.
    contentInset: 'never',
  },

  plugins: {
    SplashScreen: {
      backgroundColor: '#0b1020',
      launchAutoHide: false,
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b1020',
      overlaysWebView: true,
    },
  },

  server: {
    // Served from the bundle, so the origin is not a host the duo server can be
    // reached relative to — the build must be given VITE_SERVER_URL.
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;
