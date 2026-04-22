/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {UploadFileParams, UploadFileResult} from './types.js';

export async function uploadFile(
  frame: Frame,
  params: UploadFileParams,
): Promise<UploadFileResult> {
  const {selector, filePath} = params;
  const tooltype = 'upload_file';
  const page = frame.page();

  try {
    // Playwright: use setInputFiles on ElementHandle
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    try {
      await element.setInputFiles(filePath);
      return {
        success: true,
        message: `File uploaded from ${filePath}`,
        tooltype,
        logFormat: 'simple',
      };
    } catch {
      // Fallback: try filechooser event pattern
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', {timeout: 3000}),
        element.click(),
      ]);
      await fileChooser.setFiles(filePath);

      return {
        success: true,
        message: `File uploaded from ${filePath}`,
        tooltype,
        logFormat: 'simple',
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}