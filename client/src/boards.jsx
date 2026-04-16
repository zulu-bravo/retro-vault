// Boards page entry — Page.retrovault__c / Tab.retrovault__c
import React from 'react';
import { createRoot } from 'react-dom/client';
import { definePage } from '@veeva/vault';

import App from './App';
import { initApi } from './api/vault';

export default definePage(({ element, data = {}, sendEvent }) => {
    initApi(sendEvent, data.userId);
    const root = createRoot(element);
    root.render(<App />);
});
