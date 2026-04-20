// Teams page entry — Page.retrovault_teams__c / Tab.retrovault_teams__c
import React from 'react';
import { createRoot } from 'react-dom/client';
import { definePage } from '@veeva/vault';

import AppTeams from './App_Teams';
import { initApi } from './api/vault';

export default definePage(({ element, data = {}, sendEvent }) => {
    initApi(sendEvent, data.userId);
    const root = createRoot(element);
    root.render(<AppTeams />);
});
