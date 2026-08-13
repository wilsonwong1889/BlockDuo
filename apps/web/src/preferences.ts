import { setMuted, unlockAudio } from './audio/sfx';
import { setHapticsEnabled } from './native';
import {
  loadAppSettings,
  resolveReducedMotion,
  saveAppSettings,
  type AppSettings,
} from './storage';

const reduceMotionQuery = () =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export const systemPrefersReducedMotion = () => reduceMotionQuery()?.matches ?? false;

/** What the reduced-motion toggle should show, and what the page should do. */
export const effectiveReducedMotion = (settings: AppSettings) =>
  resolveReducedMotion(settings.reducedMotion, systemPrefersReducedMotion());

export function applyAppSettings(settings: AppSettings) {
  setMuted(!settings.sound);
  setHapticsEnabled(settings.haptics);
  // The class is the only thing the stylesheet listens to, so that an explicit
  // preference can turn motion back on for a device that asked to reduce it.
  // Nothing is on screen before this runs: React has not rendered yet.
  document.documentElement.classList.toggle('reduce-motion', effectiveReducedMotion(settings));
  document.documentElement.classList.toggle('high-contrast', settings.highContrast);
}

export function updateAppSettings(settings: AppSettings) {
  saveAppSettings(settings);
  applyAppSettings(settings);
  if (settings.sound) unlockAudio();
}

export function initialiseAppSettings(): AppSettings {
  const settings = loadAppSettings();
  applyAppSettings(settings);

  // Keep following the device for as long as the toggle has never been used, so
  // turning reduced motion on system-wide takes effect without a reload.
  reduceMotionQuery()?.addEventListener('change', () => {
    const current = loadAppSettings();
    if (current.reducedMotion === null) applyAppSettings(current);
  });

  return settings;
}
