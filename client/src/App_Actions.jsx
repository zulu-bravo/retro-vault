// App_Actions.jsx - Actions-side root.
// Standalone Vault Page (Page.retrovault_actions__c, Tab.retrovault_actions__c).
// No router — Actions is the only view this entry renders.
import React, { useState, useCallback } from 'react';

import Toast from './components/Toast';
import Actions from './pages/Actions';

export default function AppActions() {
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type, id: Date.now() });
    }, []);

    const navigate = useCallback(() => {}, []);

    return (
        <div className="vault-app">
            <div className="vault-page">
                <div className="vault-container">
                    <Actions navigate={navigate} showToast={showToast} />
                </div>
            </div>
            {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
    );
}
