import React from 'react';

export function StatusBadge({ status }) {
    if (!status) return null;
    const cls = String(status).replace(/__c$/, '');
    const label = cls.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    return <span className={'vault-badge vault-badge--' + cls}>{label}</span>;
}

export function ThemeBadge({ theme }) {
    if (!theme) return null;
    const label = String(theme).replace(/__c$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    return <span className="vault-badge vault-badge--theme">{label}</span>;
}
