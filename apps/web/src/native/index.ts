/**
 * Native shell integration.
 *
 * The same bundle runs on the web and inside the app, so every one of these is
 * a no-op unless Capacitor reports a native platform. Nothing here is allowed to
 * be load-bearing: if a plugin is missing the game still plays.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

export type Haptic = 'place' | 'clear' | 'combo' | 'error';

/**
 * A short tap when a piece lands, something heavier for a clear.
 *
 * Falls back to the Vibration API on Android web. iOS Safari has no vibration
 * at all, which is exactly why the native build is worth having.
 */
export async function haptic(kind: Haptic): Promise<void> {
  if (isNative()) {
    try {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      switch (kind) {
        case 'place':
          await Haptics.impact({ style: ImpactStyle.Light });
          return;
        case 'clear':
          await Haptics.impact({ style: ImpactStyle.Medium });
          return;
        case 'combo':
          await Haptics.notification({ type: NotificationType.Success });
          return;
        case 'error':
          await Haptics.notification({ type: NotificationType.Warning });
          return;
      }
    } catch {
      // Plugin unavailable — silence is the correct outcome for haptics.
    }
    return;
  }

  const pattern: Record<Haptic, number | number[]> = {
    place: 8,
    clear: 18,
    combo: [12, 40, 22],
    error: [30, 60, 30],
  };
  try {
    navigator.vibrate?.(pattern[kind]);
  } catch {
    /* ignore */
  }
}

/** One-time native setup: status bar, splash, deep links, hardware back. */
export async function initNative(): Promise<void> {
  if (!isNative()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* not fatal */
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    /* not fatal */
  }

  try {
    const { App } = await import('@capacitor/app');

    // A tapped invite — blokduo://duo/ABC123 or the https universal link —
    // drops straight into that room. Only the room path is honoured; anything
    // else opens the app normally rather than being followed.
    App.addListener('appUrlOpen', ({ url }) => {
      const match = url.match(/duo\/([A-Za-z0-9]{6})/);
      if (match) window.location.hash = `#/duo/${match[1].toUpperCase()}`;
    });

    // Android's back button should walk the app's own screens, and only exit
    // from the home screen.
    App.addListener('backButton', () => {
      if (window.location.hash && window.location.hash !== '#/') {
        window.location.hash = '#/';
      } else {
        void App.exitApp();
      }
    });
  } catch {
    /* not fatal */
  }
}
