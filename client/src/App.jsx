// App.jsx - Boards-side root.
// The Insights view lives in its own Vault Page (see App_Insights.jsx + the
// retrovault_insights__c Page MDL component). No inner navigation bar.
import React, { useState, useEffect, useCallback } from 'react';

import Toast from './components/Toast';
import Spinner from './components/Spinner';
import Dashboard from './pages/Dashboard';
import BoardView from './pages/BoardView';
import CreateBoard from './pages/CreateBoard';
import SeedData from './pages/SeedData';

// Matches: #custom/page/<pageName>/<boardId>  (group 1)
//      or: #custom/page/<pageName>/<boardId>/<actionId>  (group 1 + group 2)
const HASH_BOARD_RE = /#custom\/page\/[^/?]+\/([^/?#/]+)(?:\/([^/?#]+))?/;

// The Custom Page runs in a sandboxed iframe — window.location.hash is
// always empty. The record ID from the Page Link lives in the TOP frame's
// hash. Reading window.top.location may throw if cross-origin sandboxed,
// so wrap in a try/catch.
function getTopHash() {
    try { return window.top.location.hash || ''; }
    catch (e) { return window.location.hash || ''; }
}

export default function App() {
    const [view, setView] = useState(null); // null = deciding deep-link vs dashboard
    const [toast, setToast] = useState(null);

    // Check the top frame's hash for a deep-link board ID (and optional
    // action item ID). Vault may set the hash after our iframe mounts, so
    // poll briefly. While deciding, the app shows a spinner instead of
    // mounting Dashboard (which would fire queries that get aborted).
    useEffect(() => {
        function tryNavigate() {
            const match = HASH_BOARD_RE.exec(getTopHash());
            if (!match) return false;
            const boardId = decodeURIComponent(match[1]);
            const actionId = match[2] ? decodeURIComponent(match[2]) : null;
            setView({ name: 'board', boardId, actionId });
            return true;
        }
        if (tryNavigate()) return;
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            if (tryNavigate()) {
                clearInterval(timer);
            } else if (attempts >= 10) {
                clearInterval(timer);
                setView({ name: 'dashboard' });
            }
        }, 100);
        return () => clearInterval(timer);
    }, []);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type, id: Date.now() });
    }, []);

    const navigate = useCallback((name, params = {}) => {
        setView({ name, ...params });
    }, []);

    if (!view) return <div className="vault-app"><Spinner /></div>;

    let content;
    switch (view.name) {
        case 'dashboard':
            content = <Dashboard navigate={navigate} showToast={showToast} />;
            break;
        case 'board':
            content = <BoardView boardId={view.boardId} highlightId={view.actionId} navigate={navigate} showToast={showToast} />;
            break;
        case 'create-board':
            content = <CreateBoard boardId={view.boardId} navigate={navigate} showToast={showToast} />;
            break;
        case 'seed':
            content = <SeedData navigate={navigate} showToast={showToast} />;
            break;
        default:
            content = <Dashboard navigate={navigate} showToast={showToast} />;
    }

    return (
        <div className="vault-app">
            <div className="vault-page">
                <div className="vault-container">
                    {content}
                </div>
            </div>
            {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
    );
}
