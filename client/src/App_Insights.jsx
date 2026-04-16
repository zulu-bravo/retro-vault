// App_Insights.jsx - Insights-side root.
// Standalone Vault Page (Page.retrovault_insights__c, Tab.retrovault_insights__c).
// No router — Insights is the only view this entry renders.
import React, { useState, useCallback } from 'react';

import Toast from './components/Toast';
import Insights from './pages/Insights';

export default function AppInsights() {
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type, id: Date.now() });
    }, []);

    // Insights doesn't navigate anywhere else, but the prop is part of the
    // page contract — pass a no-op so the component doesn't have to branch.
    const navigate = useCallback(() => {}, []);

    return (
        <div className="vault-app">
            <div className="vault-page">
                <div className="vault-container">
                    <Insights navigate={navigate} showToast={showToast} />
                </div>
            </div>
            {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
    );
}
