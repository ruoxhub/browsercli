/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import {logger} from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface SystemProxyState {
  enabled: boolean;
  server: string;
  override: string;
  autoConfigUrl: string;
}

interface MarkerPayload {
  version: number;
  originalState: SystemProxyState;
}

const REG_PATH =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const MARKER_KEY = 'ReverserProxyOwner';
const OVERRIDE_VALUE = 'localhost;127.0.0.1;<-loopback>';

const NOTIFY_POWERSHELL = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class NativeMethods {
    [DllImport("wininet.dll", SetLastError = true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@;
[NativeMethods]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0);
[NativeMethods]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0);
`.trim();

export interface SystemProxyManagerOpts {
  platform?: NodeJS.Platform;
  runCommand?: (cmd: string, args: string[]) => Promise<string>;
  runCommandSync?: (cmd: string, args: string[]) => string;
  powershellCmd?: string;
}

interface ResolvedDeps {
  platform: NodeJS.Platform;
  runCommand: (cmd: string, args: string[]) => Promise<string>;
  runCommandSync: (cmd: string, args: string[]) => string;
}

function parseRegValue(out: string): string | null {
  const m = out.match(/REG_[A-Z_]+\s+(.*)$/m);
  if (!m) return null;
  return m[1].trim();
}

function parseDword(raw: string | null): boolean {
  if (!raw) return false;
  const num = raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw);
  return !Number.isNaN(num) && num !== 0;
}

export function resolvePowerShellPath(): string {
  if (process.platform !== 'win32') return 'powershell';
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const candidates = [
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(root, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  for (const c of candidates) {
    try {
      if (path.isAbsolute(c) && fs.existsSync(c)) return c;
    } catch {
      // 忽略检查异常
    }
  }
  return 'powershell';
}

export class SystemProxyManager {
  private readonly deps: ResolvedDeps;
  private readonly powershellCmd: string;
  private originalState: SystemProxyState | null = null;
  private hooked = false;
  private active = false;

  private readonly onExit = (): void => {
    this.restoreSync();
  };

  private readonly onUncaught = (err: Error): void => {
    this.restoreSync();
    throw err;
  };

  constructor(opts: SystemProxyManagerOpts = {}) {
    this.deps = {
      platform: opts.platform ?? process.platform,
      runCommand: opts.runCommand ?? defaultRunCommand,
      runCommandSync: opts.runCommandSync ?? defaultRunCommandSync,
    };
    this.powershellCmd =
      opts.powershellCmd ??
      (opts.runCommand ? 'powershell' : resolvePowerShellPath());
  }

  /** 检查并清理上次崩溃遗留的系统代理残留配置。 */
  async checkResidual(): Promise<boolean> {
    const marker = await this.readMarker();
    if (!marker) return false;
    const snap = this.parseMarker(marker);
    if (!snap) return false;
    await this.applyState(snap.originalState);
    await this.deleteMarker();
    return true;
  }

  /** 接管系统代理（仅 Windows）。 */
  async enable(port: number): Promise<void> {
    if (this.deps.platform !== 'win32') {
      throw new Error('systemProxyUnsupported');
    }
    if (this.active) return;

    const marker = await this.readMarker();
    if (marker && (await this.readEnabled())) {
      throw new Error(
        '系统代理已被接管（检测到残留 marker），请先 restore 或重启 worker',
      );
    }

    this.originalState = await this.readState();
    await this.writeState({
      enabled: true,
      server: `127.0.0.1:${port}`,
      override: OVERRIDE_VALUE,
      autoConfigUrl: '',
    });
    await this.writeMarker();
    this.active = true;
    this.hookLifecycle();
  }

  /** 异步还原系统代理。 */
  async restore(): Promise<void> {
    const state = this.originalState ?? (await this.readMarkerState());
    if (state) {
      await this.applyState(state);
    }
    await this.deleteMarker();
    this.originalState = null;
    this.active = false;
    this.unhookLifecycle();
  }

  /** 同步还原系统代理（退出/异常钩子使用）。 */
  restoreSync(): void {
    try {
      const state = this.originalState ?? this.readMarkerStateSync();
      if (state) {
        this.applyStateSync(state);
      }
      this.deleteMarkerSync();
    } catch (err) {
      logger.warn('[SystemProxy] restoreSync 失败:', err);
    } finally {
      this.originalState = null;
      this.active = false;
      this.unhookLifecycle();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  private hookLifecycle(): void {
    if (this.hooked) return;
    process.on('exit', this.onExit);
    process.on('uncaughtException', this.onUncaught);
    this.hooked = true;
  }

  private unhookLifecycle(): void {
    if (!this.hooked) return;
    process.removeListener('exit', this.onExit);
    process.removeListener('uncaughtException', this.onUncaught);
    this.hooked = false;
  }

  private async readMarker(): Promise<string | null> {
    try {
      const out = await this.deps.runCommand('reg', [
        'query',
        REG_PATH,
        '/v',
        MARKER_KEY,
      ]);
      return parseRegValue(out);
    } catch {
      return null;
    }
  }

  private readMarkerSync(): string | null {
    try {
      const out = this.deps.runCommandSync('reg', [
        'query',
        REG_PATH,
        '/v',
        MARKER_KEY,
      ]);
      return parseRegValue(out);
    } catch {
      return null;
    }
  }

  private parseMarker(marker: string): MarkerPayload | null {
    try {
      const payload = JSON.parse(marker) as MarkerPayload;
      if (payload && payload.version === 1 && payload.originalState) {
        return payload;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async readMarkerState(): Promise<SystemProxyState | null> {
    const marker = await this.readMarker();
    if (!marker) return null;
    return this.parseMarker(marker)?.originalState ?? null;
  }

  private readMarkerStateSync(): SystemProxyState | null {
    const marker = this.readMarkerSync();
    if (!marker) return null;
    return this.parseMarker(marker)?.originalState ?? null;
  }

  private async readEnabled(): Promise<boolean> {
    try {
      const out = await this.deps.runCommand('reg', [
        'query',
        REG_PATH,
        '/v',
        'ProxyEnable',
      ]);
      return parseDword(parseRegValue(out));
    } catch {
      return false;
    }
  }

  private async readState(): Promise<SystemProxyState> {
    const [enableOut, serverOut, overrideOut, pacOut] = await Promise.all([
      this.safeQuery('ProxyEnable'),
      this.safeQuery('ProxyServer'),
      this.safeQuery('ProxyOverride'),
      this.safeQuery('AutoConfigURL'),
    ]);
    return {
      enabled: parseDword(parseRegValue(enableOut)),
      server: parseRegValue(serverOut) ?? '',
      override: parseRegValue(overrideOut) ?? '',
      autoConfigUrl: parseRegValue(pacOut) ?? '',
    };
  }

  private async safeQuery(name: string): Promise<string> {
    try {
      return await this.deps.runCommand('reg', ['query', REG_PATH, '/v', name]);
    } catch {
      return '';
    }
  }

  private async writeState(state: SystemProxyState): Promise<void> {
    await Promise.all([
      this.deps.runCommand('reg', [
        'add',
        REG_PATH,
        '/v',
        'ProxyEnable',
        '/t',
        'REG_DWORD',
        '/d',
        state.enabled ? '1' : '0',
        '/f',
      ]),
      this.deps.runCommand('reg', [
        'add',
        REG_PATH,
        '/v',
        'ProxyServer',
        '/t',
        'REG_SZ',
        '/d',
        state.server,
        '/f',
      ]),
      this.deps.runCommand('reg', [
        'add',
        REG_PATH,
        '/v',
        'ProxyOverride',
        '/t',
        'REG_SZ',
        '/d',
        state.override,
        '/f',
      ]),
      this.deps.runCommand('reg', [
        'add',
        REG_PATH,
        '/v',
        'AutoConfigURL',
        '/t',
        'REG_SZ',
        '/d',
        state.autoConfigUrl,
        '/f',
      ]),
    ]);
    await this.notifyOptions();
  }

  private async applyState(state: SystemProxyState): Promise<void> {
    await this.writeState(state);
  }

  private applyStateSync(state: SystemProxyState): void {
    this.deps.runCommandSync('reg', [
      'add',
      REG_PATH,
      '/v',
      'ProxyEnable',
      '/t',
      'REG_DWORD',
      '/d',
      state.enabled ? '1' : '0',
      '/f',
    ]);
    this.deps.runCommandSync('reg', [
      'add',
      REG_PATH,
      '/v',
      'ProxyServer',
      '/t',
      'REG_SZ',
      '/d',
      state.server,
      '/f',
    ]);
    this.deps.runCommandSync('reg', [
      'add',
      REG_PATH,
      '/v',
      'ProxyOverride',
      '/t',
      'REG_SZ',
      '/d',
      state.override,
      '/f',
    ]);
    this.deps.runCommandSync('reg', [
      'add',
      REG_PATH,
      '/v',
      'AutoConfigURL',
      '/t',
      'REG_SZ',
      '/d',
      state.autoConfigUrl,
      '/f',
    ]);
    this.notifyOptionsSync();
  }

  private async writeMarker(): Promise<void> {
    const payload: MarkerPayload = {
      version: 1,
      originalState: this.originalState ?? {
        enabled: false,
        server: '',
        override: '',
        autoConfigUrl: '',
      },
    };
    await this.deps.runCommand('reg', [
      'add',
      REG_PATH,
      '/v',
      MARKER_KEY,
      '/t',
      'REG_SZ',
      '/d',
      JSON.stringify(payload),
      '/f',
    ]);
  }

  private async deleteMarker(): Promise<void> {
    try {
      await this.deps.runCommand('reg', [
        'delete',
        REG_PATH,
        '/v',
        MARKER_KEY,
        '/f',
      ]);
    } catch {
      // 忽略不存在错误
    }
  }

  private deleteMarkerSync(): void {
    try {
      this.deps.runCommandSync('reg', [
        'delete',
        REG_PATH,
        '/v',
        MARKER_KEY,
        '/f',
      ]);
    } catch {
      // 忽略不存在错误
    }
  }

  private async notifyOptions(): Promise<void> {
    try {
      await this.deps.runCommand(this.powershellCmd, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        NOTIFY_POWERSHELL,
      ]);
    } catch (err) {
      logger.warn('[SystemProxy] powershell 通知刷新失败:', err);
    }
  }

  private notifyOptionsSync(): void {
    try {
      this.deps.runCommandSync(this.powershellCmd, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        NOTIFY_POWERSHELL,
      ]);
    } catch (err) {
      logger.warn('[SystemProxy] powershell 通知刷新失败:', err);
    }
  }
}

async function defaultRunCommand(cmd: string, args: string[]): Promise<string> {
  const {stdout} = await execFileAsync(cmd, args, {
    timeout: 3000,
    windowsHide: true,
  });
  return stdout;
}

function defaultRunCommandSync(cmd: string, args: string[]): string {
  const res = spawnSync(cmd, args, {
    timeout: 3000,
    windowsHide: true,
    encoding: 'utf-8',
  });
  return res.stdout ?? '';
}
