/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import {createRoot} from 'react-dom/client';

import App from './App';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
