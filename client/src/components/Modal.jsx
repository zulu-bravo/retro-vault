import React from 'react';

export default function Modal({ title, children, onClose, onConfirm, confirmLabel = 'Save', confirmDisabled = false, onDelete, deleteDisabled = false }) {
    return (
        <div className="vault-modal-overlay vault-modal-overlay--visible" onClick={(e) => {
            if (e.target.classList.contains('vault-modal-overlay')) onClose();
        }}>
            <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
                <div className="vault-modal__header">
                    <div className="vault-modal__title">{title}</div>
                    <button className="vault-modal__close" onClick={onClose}>&times;</button>
                </div>
                <div className="vault-modal__body">{children}</div>
                <div className="vault-modal__footer" style={onDelete ? { justifyContent: 'space-between' } : undefined}>
                    {onDelete && (
                        <button
                            className="vault-btn vault-btn--danger"
                            onClick={onDelete}
                            disabled={deleteDisabled}
                        >
                            Delete
                        </button>
                    )}
                    <div className="vault-flex vault-gap-8">
                        <button className="vault-btn vault-btn--secondary" onClick={onClose}>Cancel</button>
                        <button
                            className="vault-btn vault-btn--primary"
                            onClick={onConfirm}
                            disabled={confirmDisabled}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
