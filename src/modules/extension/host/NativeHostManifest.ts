/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXTENSION_HOST_NAME = 'com.proxycli.reverserextension';

export interface NativeHostPaths {
  configDir: string;
  manifestPath: string;
  scriptPath: string;
}

export function getNativeHostPaths(): NativeHostPaths {
  const home = os.homedir();
  const configDir = path.join(home, '.proxycli', 'extension-host');
  const manifestPath = path.join(configDir, `${EXTENSION_HOST_NAME}.json`);
  const scriptExt = process.platform === 'win32' ? 'cmd' : 'sh';
  const scriptPath = path.join(configDir, `host-bridge.${scriptExt}`);

  return {configDir, manifestPath, scriptPath};
}

export function generateNativeHostManifest(
  targetScriptPath: string,
  allowedOrigins: string[] = ['chrome-extension://*'],
): object {
  return {
    name: EXTENSION_HOST_NAME,
    description: 'ProxyCLI Browser Extension Native Messaging Host',
    path: targetScriptPath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };
}

export function installNativeHost(options?: {
  nodePath?: string;
  cliEntryPath?: string;
  allowedOrigins?: string[];
}): {
  success: boolean;
  manifestPath: string;
  scriptPath: string;
  message: string;
} {
  const {configDir, manifestPath, scriptPath} = getNativeHostPaths();
  fs.mkdirSync(configDir, {recursive: true});

  const nodeExecutable = options?.nodePath ?? process.execPath;
  const projectRoot = process.cwd();
  // Target node runner script
  const bridgeCliPath =
    options?.cliEntryPath ??
    path.join(projectRoot, 'build', 'src', 'cli', 'bin', 'proxycli.js');

  // Create wrapper script
  if (process.platform === 'win32') {
    const cmdContent = `@echo off\r\n"${nodeExecutable}" "${bridgeCliPath}" extension host-bridge %*\r\n`;
    fs.writeFileSync(scriptPath, cmdContent, 'utf8');
  } else {
    const shContent = `#!/bin/sh\nexec "${nodeExecutable}" "${bridgeCliPath}" extension host-bridge "$@"\n`;
    fs.writeFileSync(scriptPath, shContent, {mode: 0o755, encoding: 'utf8'});
  }

  // Create manifest JSON
  const manifest = generateNativeHostManifest(
    scriptPath,
    options?.allowedOrigins ?? ['chrome-extension://*'],
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Register in OS
  if (process.platform === 'win32') {
    const registryKeys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`,
      `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`,
    ];

    for (const regKey of registryKeys) {
      try {
        execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, {
          stdio: 'ignore',
        });
      } catch {
        // Ignored if specific browser is not present
      }
    }
  } else if (process.platform === 'darwin') {
    const home = os.homedir();
    const macDirs = [
      path.join(
        home,
        'Library/Application Support/Google/Chrome/NativeMessagingHosts',
      ),
      path.join(
        home,
        'Library/Application Support/Chromium/NativeMessagingHosts',
      ),
      path.join(
        home,
        'Library/Application Support/Microsoft Edge/NativeMessagingHosts',
      ),
      path.join(
        home,
        'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
      ),
    ];
    for (const dir of macDirs) {
      try {
        fs.mkdirSync(dir, {recursive: true});
        fs.copyFileSync(
          manifestPath,
          path.join(dir, `${EXTENSION_HOST_NAME}.json`),
        );
      } catch {
        // ignore
      }
    }
  } else {
    // Linux
    const home = os.homedir();
    const linuxDirs = [
      path.join(home, '.config/google-chrome/NativeMessagingHosts'),
      path.join(home, '.config/chromium/NativeMessagingHosts'),
      path.join(home, '.config/microsoft-edge/NativeMessagingHosts'),
      path.join(
        home,
        '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
      ),
    ];
    for (const dir of linuxDirs) {
      try {
        fs.mkdirSync(dir, {recursive: true});
        fs.copyFileSync(
          manifestPath,
          path.join(dir, `${EXTENSION_HOST_NAME}.json`),
        );
      } catch {
        // ignore
      }
    }
  }

  return {
    success: true,
    manifestPath,
    scriptPath,
    message: `Native Messaging Host installed successfully at ${manifestPath}`,
  };
}

export function uninstallNativeHost(): {success: boolean; message: string} {
  const {manifestPath, scriptPath} = getNativeHostPaths();

  if (process.platform === 'win32') {
    const registryKeys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`,
      `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`,
    ];
    for (const regKey of registryKeys) {
      try {
        execSync(`reg delete "${regKey}" /f`, {stdio: 'ignore'});
      } catch {
        // ignore
      }
    }
  }

  try {
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
  } catch {
    // ignore
  }

  return {
    success: true,
    message: 'Native Messaging Host uninstalled',
  };
}
