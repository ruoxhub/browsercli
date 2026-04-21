/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {SetFilesParams, SetFilesResult} from './types.js';

export async function setFiles(
  frame: Frame,
  params: SetFilesParams,
): Promise<SetFilesResult> {
  const {selector, filePaths} = params;
  const tooltype = 'set_files';
  const page = frame.page();

  try {
    const client = await page.createCDPSession();

    await client.send('DOM.enable', {});

    const doc = await client.send('DOM.getDocument', {});

    const node = await client.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    });

    if (!node.nodeId) {
      throw new Error(`Element not found: ${selector}`);
    }

    await client.send('DOM.setFileInputFiles', {
      nodeId: node.nodeId,
      files: filePaths,
    });

    return {
      success: true,
      message: `Set ${filePaths.length} file(s) to ${selector}`,
      tooltype,
      logFormat: 'json',
      data: {files: filePaths.length},
    };
  } catch (error) {
    return {
      success: false,
      message: `SetFiles failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      data: {files: 0},
    };
  }
}