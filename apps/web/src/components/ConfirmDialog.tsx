interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="panel confirm-panel">
        <h2 className="panel-title">{title}</h2>
        <p className="panel-note">{message}</p>
        <div className="panel-actions">
          <button className={`btn${danger ? ' danger' : ' primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
