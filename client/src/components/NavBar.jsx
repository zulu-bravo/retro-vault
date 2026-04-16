import React from 'react';

export default function NavBar({ activePage, navigate }) {
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
        </nav>
    );
}
