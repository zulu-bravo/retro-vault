// Insights page entry — Page.retrovault_insights__c / Tab.retrovault_insights__c
import React from 'react';
import { createRoot } from 'react-dom/client';
import { definePage } from '@veeva/vault';

import AppInsights from './App_Insights';
import { initApi } from './api/vault';

export default definePage(({ element, data = {}, sendEvent }) => {
    initApi(sendEvent, data.userId);
    const root = createRoot(element);
    root.render(<AppInsights />);
});
