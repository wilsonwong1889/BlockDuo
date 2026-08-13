import { Modal } from './Modal';

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
    <Modal title={title} panelClassName="confirm-panel" onDismiss={onCancel}>
      <p className="panel-note">{message}</p>
      <div className="panel-actions">
        <button className={`btn${danger ? ' danger' : ' primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
