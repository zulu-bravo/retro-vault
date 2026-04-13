// RetroVault - Custom Page entry point
import React from 'react';
import { createRoot } from 'react-dom/client';
import { definePage } from '@veeva/vault';

import App from './App';
import { initApi } from './api/vault';

export default definePage(({ element, data = {}, sendEvent }) => {
    // Initialize our API layer with the sendEvent function and current userId
    initApi(sendEvent, data.userId);

    const root = createRoot(element);
    root.render(<App />);
});
