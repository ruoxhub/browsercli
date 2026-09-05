/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import readline from 'node:readline';
import type {Readable, Writable} from 'node:stream';

import type {MitmModule} from './MitmModule.js';

export function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (const char of line) {
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export class ProxyCli {
  protected rl: readline.Interface | null = null;
  protected tailEnabled = false;
  protected selectedId: string | null = null;

  constructor(
    protected readonly module: MitmModule,
    protected readonly input: NodeJS.ReadableStream = process.stdin,
    protected readonly output: NodeJS.WritableStream = process.stdout,
  ) {}

  write(message: string): void {
    this.output.write(message);
  }

  writeLine(line = ''): void {
    this.output.write(line + '\n');
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  protected updatePrompt(port?: number | null): void {
    const promptStr = port !== undefined && port !== null ? `proxy[${port}]> ` : 'proxy[stopped]> ';
    if (this.rl) {
      this.rl.setPrompt(promptStr);
    }
  }

  async handleStart(args: string[]): Promise<void> {
    const currentStatus = this.module.status().data;
    if (currentStatus.running) {
      this.writeLine(
        `[WARN] Proxy is already running on port ${currentStatus.port}. Use restart to change settings.`,
      );
      return;
    }

    const port = args[0] !== undefined ? Number(args[0]) : 8888;
    if (Number.isNaN(port) || port < 0 || port > 65535) {
      this.writeLine(`[ERROR] Invalid port: ${args[0]}. Port must be 0-65535.`);
      return;
    }

    const upstream = args[1];
    const res = await this.module.start(port, upstream);
    if (res.success) {
      const actualPort = res.data.port;
      const upstreamNote = res.data.upstreamProxy ? ` (upstream: ${res.data.upstreamProxy})` : '';
      this.writeLine(`[INFO] MITM Proxy started on port ${actualPort}${upstreamNote}.`);
      this.updatePrompt(actualPort);
    } else {
      this.writeLine(`[ERROR] Failed to start MITM proxy: ${res.message}`);
    }
  }

  async handleStop(): Promise<void> {
    const res = await this.module.stop();
    if (res.success) {
      this.writeLine('[INFO] Proxy stopped.');
      this.updatePrompt(null);
    } else {
      this.writeLine(`[ERROR] Failed to stop proxy: ${res.message}`);
    }
  }

  async handleRestart(args: string[]): Promise<void> {
    await this.handleStop();
    await this.handleStart(args);
  }

  handleStatus(): void {
    const status = this.module.status().data;
    const sysProxyActive = this.module.getSystemProxyManager().isActive();
    const rulesCount = this.module.listRules().data.rules.length;
    const filters = this.module.listHostFilters().data;
    const localApps = this.module.getLocalAppsStatus();

    this.writeLine('┌──────────────────────── Proxy Status ────────────────────────┐');
    this.writeLine(`│ Server Status    : ${status.running ? 'RUNNING' : 'STOPPED'}`);
    this.writeLine(`│ Port             : ${status.port !== null ? status.port : '-'}`);
    this.writeLine(`│ Upstream Proxy   : ${status.upstreamProxy ?? 'None'}`);
    this.writeLine(`│ System Proxy     : ${sysProxyActive ? 'ENABLED' : 'DISABLED'}`);
    this.writeLine(`│ Captured Requests: ${status.capturedCount}`);
    this.writeLine(`│ Rewrite Rules    : ${rulesCount} active`);
    this.writeLine(`│ Host Filters     : ${filters.allow.length} allowed, ${filters.block.length} blocked`);
    this.writeLine(`│ Local Apps       : ${localApps.enabled ? `Enabled (${localApps.targets.join(', ') || 'all'})` : 'Disabled'}`);
    this.writeLine('└──────────────────────────────────────────────────────────────┘');
  }

  async handleCommand(rawLine: string): Promise<boolean> {
    const tokens = tokenizeLine(rawLine.trim());
    if (tokens.length === 0) return true;

    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    switch (cmd) {
      case 'start':
        await this.handleStart(args);
        return true;
      case 'stop':
        await this.handleStop();
        return true;
      case 'restart':
        await this.handleRestart(args);
        return true;
      case 'status':
        this.handleStatus();
        return true;
      case 'help':
      case 'h':
      case '?':
        this.printHelp(args[0]);
        return true;
      case 'exit':
      case 'quit':
      case 'q':
        this.writeLine('[INFO] Exiting proxy CLI...');
        return false;
      default:
        this.writeLine(
          `[ERROR] Unknown command: ${tokens[0]}. Type 'help' for guidance.`,
        );
        return true;
    }
  }

  printHelp(_command?: string): void {
    this.writeLine('Available commands:');
    this.writeLine('  start [port] [upstr]   Start MITM proxy server (default port 8888)');
    this.writeLine('  stop                   Stop MITM proxy server');
    this.writeLine('  restart [port] [upstr] Restart MITM proxy server');
    this.writeLine('  status                 Show proxy runtime status dashboard');
    this.writeLine('  help [cmd]             Show help message');
    this.writeLine('  exit / quit / q        Exit CLI');
  }

  async start(): Promise<void> {
    const initialStatus = this.module.status().data;
    const initialPrompt = initialStatus.running && initialStatus.port
      ? `proxy[${initialStatus.port}]> `
      : 'proxy[stopped]> ';

    this.rl = readline.createInterface({
      input: this.input as Readable,
      output: this.output as Writable,
      prompt: initialPrompt,
    });

    this.rl.prompt();
    for await (const line of this.rl) {
      const shouldContinue = await this.handleCommand(line);
      if (!shouldContinue) {
        this.rl.close();
        break;
      }
      this.rl.prompt();
    }
  }
}
