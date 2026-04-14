import React from 'react';
import { getCurrentUserId } from '../api/vault';

export default function NavBar({ activePage, navigate }) {
    const currentUserId = getCurrentUserId();
    const links = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'insights', label: 'Insights' }
    ];

    return (
        <nav className="vault-nav">
            <a className="vault-nav__logo" onClick={() => navigate('dashboard')}>Retro Boards</a>
            <div className="vault-nav__links">
                {links.map(l => (
                    <a
                        key={l.id}
                        className={'vault-nav__link' + (l.id === activePage ? ' vault-nav__link--active' : '')}
                        onClick={() => navigate(l.id)}
                    >
                        {l.label}
                    </a>
                ))}
            </div>
            <div className="vault-nav__right">
                {currentUserId && (
                    <span className="vault-nav__user-label">
                        User: {currentUserId.slice(0, 8)}...
                    </span>
                )}
            </div>
        </nav>
    );
}
