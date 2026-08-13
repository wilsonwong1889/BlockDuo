import { Modal } from './Modal';
import { effectiveReducedMotion } from '../preferences';
import type { AppSettings } from '../storage';

interface Props {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
}

// Reduced motion is stored as null until the toggle is used, so what the row
// shows is the resolved answer rather than the raw preference — otherwise it
// reads "off" on a device that is already suppressing motion.
const OPTIONS: Array<{
  key: keyof AppSettings;
  label: string;
  description: string;
  read: (settings: AppSettings) => boolean;
}> = [
  {
    key: 'sound',
    label: 'Sound',
    description: 'Game sounds and turn alerts',
    read: (settings) => settings.sound,
  },
  {
    key: 'haptics',
    label: 'Haptics',
    description: 'Device feedback for moves and clears',
    read: (settings) => settings.haptics,
  },
  {
    key: 'reducedMotion',
    label: 'Reduced motion',
    description: 'Follows your device until you change it here',
    read: effectiveReducedMotion,
  },
  {
    key: 'highContrast',
    label: 'High contrast',
    description: 'Brighter text, edges, and controls',
    read: (settings) => settings.highContrast,
  },
];

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <Modal title="Settings" panelClassName="preferences-panel" onDismiss={onClose}>
      <div className="settings-list">
        {OPTIONS.map((option) => (
          <label className="settings-row" key={option.key}>
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
            <input
              type="checkbox"
              checked={option.read(settings)}
              onChange={(event) =>
                onChange({ ...settings, [option.key]: event.target.checked })
              }
            />
          </label>
        ))}
      </div>
      <button className="btn primary" onClick={onClose} autoFocus>
        Done
      </button>
    </Modal>
  );
}
