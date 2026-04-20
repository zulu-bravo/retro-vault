// App_Teams.jsx - Teams-side root.
// Standalone Vault Page (Page.retrovault_teams__c, Tab.retrovault_teams__c).
import React, { useState, useCallback } from 'react';

import Toast from './components/Toast';
import Teams from './pages/Teams';

export default function AppTeams() {
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type, id: Date.now() });
    }, []);

    const navigate = useCallback(() => {}, []);

    return (
        <div className="vault-app">
            <div className="vault-page">
                <div className="vault-container">
                    <Teams navigate={navigate} showToast={showToast} />
                </div>
            </div>
            {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
    );
}
