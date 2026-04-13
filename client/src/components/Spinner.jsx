import React from 'react';

export default function Spinner() {
    return (
        <div className="vault-spinner">
            <div className="vault-spinner__ring"></div>
        </div>
    );
}

export function EmptyState({ message }) {
    return (
        <div className="vault-empty">
            <div className="vault-empty__icon">💭</div>
            <div className="vault-empty__text">{message}</div>
        </div>
    );
}
