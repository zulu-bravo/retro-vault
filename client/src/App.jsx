// App.jsx - Root component with simple state-based routing
import React, { useState, useCallback } from 'react';

import NavBar from './components/NavBar';
import Toast from './components/Toast';
import Dashboard from './pages/Dashboard';
import BoardView from './pages/BoardView';
import Insights from './pages/Insights';
import CreateBoard from './pages/CreateBoard';
import SeedData from './pages/SeedData';

export default function App() {
    const [view, setView] = useState({ name: 'dashboard' });
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type, id: Date.now() });
    }, []);

    const navigate = useCallback((name, params = {}) => {
        setView({ name, ...params });
    }, []);

    let content;
    switch (view.name) {
        case 'dashboard':
            content = <Dashboard navigate={navigate} showToast={showToast} />;
            break;
        case 'board':
            content = <BoardView boardId={view.boardId} navigate={navigate} showToast={showToast} />;
            break;
        case 'insights':
            content = <Insights navigate={navigate} showToast={showToast} />;
            break;
        case 'create-board':
            content = <CreateBoard navigate={navigate} showToast={showToast} />;
            break;
        case 'seed':
            content = <SeedData navigate={navigate} showToast={showToast} />;
            break;
        default:
            content = <Dashboard navigate={navigate} showToast={showToast} />;
    }

    return (
        <div className="vault-app">
            <NavBar activePage={view.name} navigate={navigate} />
            <div className="vault-page">
                <div className="vault-container">
                    {content}
                </div>
            </div>
            {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
    );
}
