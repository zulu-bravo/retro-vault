// App_Releases.jsx - Releases-side root.
// Standalone Vault Page (Page.retrovault_releases__c, Tab.retrovault_releases__c).
import React, { useState, useCallback } from 'react';

import Toast from './components/Toast';
import Releases from './pages/Releases';

export default function AppReleases() {
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type, id: Date.now() });
    }, []);

    const navigate = useCallback(() => {}, []);

    return (
        <div className="vault-app">
            <div className="vault-page">
                <div className="vault-container">
                    <Releases navigate={navigate} showToast={showToast} />
                </div>
            </div>
            {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
    );
}
