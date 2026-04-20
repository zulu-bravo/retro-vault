// Releases page entry — Page.retrovault_releases__c / Tab.retrovault_releases__c
import React from 'react';
import { createRoot } from 'react-dom/client';
import { definePage } from '@veeva/vault';

import AppReleases from './App_Releases';
import { initApi } from './api/vault';

export default definePage(({ element, data = {}, sendEvent }) => {
    initApi(sendEvent, data.userId);
    const root = createRoot(element);
    root.render(<AppReleases />);
});
