/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {existsSync} from 'node:fs';
import {readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const projectRoot = process.cwd();

const filesToRemove = [
  'node_modules/chrome-devtools-frontend/package.json',
  'node_modules/chrome-devtools-frontend/front_end/models/trace/lantern/testing',
  'node_modules/chrome-devtools-frontend/front_end/third_party/intl-messageformat/package/package.json',
];

async function patchPatchrightCore() {
  const nmPath = resolve(
    projectRoot,
    'node_modules/patchright-core/lib/server/chromium/crNetworkManager.js',
  );
  if (existsSync(nmPath)) {
    const code = await readFile(nmPath, 'utf-8');
    const target =
      'if (info.isMain)\n        return cb(info);\n      return cb(info).catch((e) => {\n        if ((0, import_protocolError.isSessionClosedError)(e))\n          return;\n        throw e;\n      });';
    const replacement =
      'return cb(info).catch((e) => {\n        if ((0, import_protocolError.isSessionClosedError)(e))\n          return;\n        throw e;\n      });';
    if (code.includes(target)) {
      console.log('Patching patchright-core crNetworkManager.js...');
      await writeFile(nmPath, code.replace(target, replacement), 'utf-8');
    }
  }

  const brPath = resolve(
    projectRoot,
    'node_modules/patchright-core/lib/server/chromium/crBrowser.js',
  );
  if (existsSync(brPath)) {
    const code = await readFile(brPath, 'utf-8');
    const target =
      'await Promise.all([...this._crPages.values()].map((crPage) => crPage._page.waitForInitializedOrError()));';
    const replacement =
      'await Promise.all([...this._crPages.values()].map((crPage) => Promise.race([crPage._page.waitForInitializedOrError(), new Promise(r => setTimeout(r, 1500))])));';
    if (code.includes(target)) {
      console.log('Patching patchright-core crBrowser.js...');
      await writeFile(brPath, code.replace(target, replacement), 'utf-8');
    }
  }
}

async function main() {
  console.log('Running prepare script to clean up chrome-devtools-frontend...');
  for (const file of filesToRemove) {
    const fullPath = resolve(projectRoot, file);
    console.log(`Removing: ${file}`);
    try {
      await rm(fullPath, {recursive: true, force: true});
    } catch (error) {
      console.error(`Failed to remove ${file}:`, error);
      process.exit(1);
    }
  }
  console.log('Clean up of chrome-devtools-frontend complete.');
  await patchPatchrightCore();
}

void main();
