/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'input',
  description: 'User input simulation tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './input/click.js',
      handlerName: 'click',
      requirements: {
        browser: 'connected',
        page: 'selected',
        frame: 'selected',
        debugger: 'running',
      },
    },
    {modulePath: './input/pressKey.js', handlerName: 'pressKey'},
    {modulePath: './input/fillForm.js', handlerName: 'fillForm'},
    {modulePath: './input/uploadFile.js', handlerName: 'uploadFile'},
    {modulePath: './input/hover.js', handlerName: 'hover'},
    {modulePath: './input/drag.js', handlerName: 'drag'},
    {modulePath: './input/clickAt.js', handlerName: 'clickAt'},
    {modulePath: './input/fill.js', handlerName: 'fill'},
  ],
} satisfies DomainManifest;
