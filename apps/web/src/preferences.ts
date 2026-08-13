import { setMuted, unlockAudio } from './audio/sfx';
import { setHapticsEnabled } from './native';
import { loadAppSettings, saveAppSettings, type AppSettings } from './storage';

export function applyAppSettings(settings: AppSettings) {
  setMuted(!settings.sound);
  setHapticsEnabled(settings.haptics);
  document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
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
  return settings;
}
