// Actions page entry — Page.retrovault_actions__c / Tab.retrovault_actions__c
import React from 'react';
import { createRoot } from 'react-dom/client';
import { definePage } from '@veeva/vault';

import AppActions from './App_Actions';
import { initApi } from './api/vault';

export default definePage(({ element, data = {}, sendEvent }) => {
    initApi(sendEvent, data.userId);
    const root = createRoot(element);
    root.render(<AppActions />);
});
