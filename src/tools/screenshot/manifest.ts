/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'screenshot',
  description: 'Screenshot and video frame tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './screenshot/takeScreenshot.js',
      handlerName: 'takeScreenshot',
    },
    {
      modulePath: './screenshot/captureVideoFrame.js',
      handlerName: 'captureVideoFrame',
    },
    {modulePath: './screenshot/getVideoInfo.js', handlerName: 'getVideoInfo'},
    {modulePath: './screenshot/seekVideo.js', handlerName: 'seekVideo'},
  ],
} satisfies DomainManifest;
