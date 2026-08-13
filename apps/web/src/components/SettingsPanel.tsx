import type { AppSettings } from '../storage';

interface Props {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
}

const OPTIONS: Array<{
  key: keyof AppSettings;
  label: string;
  description: string;
}> = [
  { key: 'sound', label: 'Sound', description: 'Game sounds and turn alerts' },
  { key: 'haptics', label: 'Haptics', description: 'Device feedback for moves and clears' },
  { key: 'reducedMotion', label: 'Reduced motion', description: 'Minimize movement and animations' },
  { key: 'highContrast', label: 'High contrast', description: 'Brighter text, edges, and controls' },
];

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="panel preferences-panel">
        <h2 className="panel-title">Settings</h2>
        <div className="settings-list">
          {OPTIONS.map((option) => (
            <label className="settings-row" key={option.key}>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <input
                type="checkbox"
                checked={settings[option.key]}
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
      </div>
    </div>
  );
}
