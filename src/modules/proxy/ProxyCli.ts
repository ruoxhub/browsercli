/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import readline from 'node:readline';
import type {Readable, Writable} from 'node:stream';

import type {MitmModule} from './MitmModule.js';
import type {CapturedRequest} from './types.js';

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

function formatBody(body: string | null): string {
  if (body === null || body === '') return '(empty)';
  if (body.length > 65536) {
    return (
      body.slice(0, 65536) +
      '\n... [Truncated: >64KB, use "har export" for full payload]'
    );
  }
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
}

export class ProxyCli {
  protected rl: readline.Interface | null = null;
  protected tailEnabled = false;
  protected selectedId: string | null = null;
  private readonly onCapture = (record: CapturedRequest): void => {
    if (this.tailEnabled) {
      this.safeLog(this.formatTailRecord(record));
    }
  };

  constructor(
    protected readonly module: MitmModule,
    protected readonly input: NodeJS.ReadableStream = process.stdin,
    protected readonly output: NodeJS.WritableStream = process.stdout,
  ) {
    this.module.getStore().events.on('capture', this.onCapture);
  }

  write(message: string): void {
    this.output.write(message);
  }

  writeLine(line = ''): void {
    this.output.write(line + '\n');
  }

  safeLog(message: string): void {
    if (!this.rl) {
      this.output.write(message + '\n');
      return;
    }
    this.output.write('\r\x1b[K');
    this.output.write(message + '\n');
    this.rl.prompt(true);
  }

  private formatTailRecord(record: CapturedRequest): string {
    const code = record.statusCode;
    let colorCode = String(code);
    if (code >= 200 && code < 300) {
      colorCode = `\x1b[32m${code}\x1b[0m`;
    } else if (code >= 300 && code < 400) {
      colorCode = `\x1b[34m${code}\x1b[0m`;
    } else if (code >= 400 && code < 500) {
      colorCode = `\x1b[33m${code}\x1b[0m`;
    } else if (code >= 500) {
      colorCode = `\x1b[31m${code}\x1b[0m`;
    }

    const duration = record.durationMs !== undefined ? `${record.durationMs}ms` : '0ms';
    const size = record.responseBody ? `${record.responseBody.length}B` : `${record.responseBodySize ?? 0}B`;
    const modifiedTag = record.modified ? ' \x1b[35m[MODIFIED]\x1b[0m' : '';

    return `[#${record.id}] ${colorCode} ${record.method} ${record.url} (${duration}, ${size})${modifiedTag}`;
  }

  close(): void {
    this.module.getStore().events.off('capture', this.onCapture);
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

  handleLs(args: string[]): void {
    let limit = 15;
    let filterStr = '';

    if (args.length > 0) {
      const parsedNum = Number(args[0]);
      if (!Number.isNaN(parsedNum) && parsedNum > 0) {
        limit = Math.min(100, parsedNum);
        filterStr = args.slice(1).join(' ');
      } else {
        filterStr = args.join(' ');
      }
    }

    let records = this.module.getStore().list();
    if (filterStr) {
      const f = filterStr.toLowerCase();
      records = records.filter(
        r =>
          r.url.toLowerCase().includes(f) ||
          r.method.toLowerCase().includes(f) ||
          String(r.id).toLowerCase().includes(f) ||
          String(r.statusCode).includes(f),
      );
    }

    const items = records.slice(-limit);
    if (items.length === 0) {
      this.writeLine('No captured requests found.');
      return;
    }

    this.writeLine(
      `${'ID'.padEnd(8)} ${'METHOD'.padEnd(7)} ${'STATUS'.padEnd(7)} ${'DURATION'.padEnd(9)} ${'SIZE'.padEnd(8)} URL`,
    );
    this.writeLine('-'.repeat(80));

    for (const r of items) {
      const idStr = `#${r.id}`.padEnd(8);
      const methodStr = r.method.padEnd(7);
      const statusStr = String(r.statusCode).padEnd(7);
      const durationStr = (r.durationMs !== undefined ? `${r.durationMs}ms` : '-').padEnd(9);
      const bodyLen = r.responseBody ? r.responseBody.length : (r.responseBodySize ?? 0);
      const sizeStr = `${bodyLen}B`.padEnd(8);
      const maxUrlLen = 80 - 45;
      const urlStr = r.url.length > maxUrlLen ? `${r.url.slice(0, maxUrlLen - 3)}...` : r.url;

      this.writeLine(
        `${idStr} ${methodStr} ${statusStr} ${durationStr} ${sizeStr} ${urlStr}`,
      );
    }
  }

  handleShow(args: string[]): void {
    const records = this.module.getStore().list();
    if (records.length === 0) {
      this.writeLine('[WARN] No requests captured yet.');
      return;
    }

    let targetId: string | null = null;
    let part = 'all';

    const validParts = ['all', 'req', 'res', 'headers', 'body'];
    if (args.length > 0) {
      if (validParts.includes(args[0].toLowerCase())) {
        part = args[0].toLowerCase();
        targetId = this.selectedId ?? String(records.at(-1)?.id);
      } else {
        targetId = args[0].replace(/^#/, '');
        if (args.length > 1 && validParts.includes(args[1].toLowerCase())) {
          part = args[1].toLowerCase();
        }
      }
    } else {
      targetId = this.selectedId ?? String(records.at(-1)?.id);
    }

    const record = this.module.getStore().get(targetId);
    if (!record) {
      this.writeLine(`[ERROR] Request #${targetId} not found.`);
      return;
    }

    this.selectedId = String(record.id);

    this.writeLine(`=== Request #${record.id} [${record.method} ${record.url}] ===`);
    this.writeLine('[General]');
    this.writeLine(`  URL         : ${record.url}`);
    this.writeLine(`  Method      : ${record.method}`);
    this.writeLine(`  Status      : ${record.statusCode}`);
    this.writeLine(`  Duration    : ${record.durationMs ?? 0}ms`);
    this.writeLine(`  Client IP   : ${record.clientIp ?? '-'}`);
    this.writeLine(`  Time        : ${new Date(record.timestamp).toISOString()}`);

    const showReq = part === 'all' || part === 'req';
    const showRes = part === 'all' || part === 'res';
    const showHeaders = part === 'headers';
    const showBody = part === 'body';

    if (showReq || showHeaders) {
      this.writeLine('[Request Headers]');
      for (const [k, v] of Object.entries(record.requestHeaders)) {
        this.writeLine(`  ${k}: ${v}`);
      }
    }

    if (showReq || showBody) {
      this.writeLine('[Request Body]');
      this.writeLine(formatBody(record.requestBody));
    }

    if (showRes || showHeaders) {
      this.writeLine('[Response Headers]');
      for (const [k, v] of Object.entries(record.responseHeaders)) {
        this.writeLine(`  ${k}: ${v}`);
      }
    }

    if (showRes || showBody) {
      this.writeLine('[Response Body]');
      this.writeLine(formatBody(record.responseBody));
    }
  }

  async handleCurl(args: string[]): Promise<void> {
    const records = this.module.getStore().list();
    if (records.length === 0) {
      this.writeLine('[WARN] No requests captured yet.');
      return;
    }

    const targetId = args[0]
      ? args[0].replace(/^#/, '')
      : (this.selectedId ?? String(records.at(-1)?.id));

    // SAFETY: Delegate to MitmModule getRequest which accepts number or injected string id at runtime.
    const res = await this.module.getRequest({
      id: targetId as unknown as number,
      format: 'curl',
    });

    if (res.success && res.data.curl) {
      this.writeLine(res.data.curl);
    } else {
      this.writeLine(`[ERROR] Failed to generate curl for request #${targetId}: ${res.message}`);
    }
  }

  handleClear(): void {
    const res = this.module.clear();
    this.selectedId = null;
    this.writeLine(`[INFO] Cleared ${res.data.clearedCount} captured requests.`);
  }

  handleTail(args: string[]): void {
    if (args.length > 0) {
      const mode = args[0].toLowerCase();
      if (mode === 'on') {
        this.tailEnabled = true;
      } else if (mode === 'off') {
        this.tailEnabled = false;
      } else {
        this.writeLine(`[ERROR] Invalid tail argument: ${args[0]}. Use 'on' or 'off'.`);
        return;
      }
    } else {
      this.tailEnabled = !this.tailEnabled;
    }
    this.writeLine(`[INFO] Tail is now ${this.tailEnabled ? 'ON' : 'OFF'}.`);
  }

  handleRule(args: string[]): void {
    if (args.length === 0) {
      this.writeLine(
        "[ERROR] Missing rule subcommand. Use 'rule ls', 'rule add', 'rule rm', 'rule clear'.",
      );
      return;
    }

    const sub = args[0].toLowerCase();
    switch (sub) {
      case 'ls':
      case 'list': {
        const rules = this.module.listRules().data.rules;
        if (rules.length === 0) {
          this.writeLine('No rewrite rules configured.');
          return;
        }
        this.writeLine(
          `${'ID'.padEnd(14)} ${'TYPE'.padEnd(10)} ${'URL_PATTERN'.padEnd(25)} DETAILS`,
        );
        this.writeLine('-'.repeat(75));
        for (const r of rules) {
          const idStr = r.id.padEnd(14);
          let typeStr: string = r.action.type;
          let details = '';
          if (r.action.type === 'block') {
            typeStr = r.action.body !== undefined ? 'mock' : 'block';
            details = `status: ${r.action.statusCode}${r.action.body ? `, body: ${r.action.body}` : ''}`;
          } else if (r.action.type === 'map_remote') {
            typeStr = 'redirect';
            details = `-> ${r.action.replacement}`;
          } else if (r.action.type === 'modify_header') {
            typeStr = 'header';
            details = JSON.stringify(r.action.set ?? {});
          } else if (r.action.type === 'map_local') {
            typeStr = 'map_local';
            details = r.action.localPath;
          }
          const ruleRegex = 'urlRegex' in r.action ? r.action.urlRegex : undefined;
          const pattern = (r.urlFilter ?? ruleRegex ?? '*').padEnd(25);
          this.writeLine(`${idStr} ${typeStr.padEnd(10)} ${pattern} ${details}`);
        }
        return;
      }
      case 'add': {
        if (args.length < 3) {
          this.writeLine(
            '[ERROR] Usage: rule add <mock|redirect|header> <urlPattern> ...',
          );
          return;
        }
        const actionType = args[1].toLowerCase();
        const pattern = args[2];
        if (actionType === 'mock') {
          const status = args[3] !== undefined ? Number(args[3]) : 200;
          const body = args.slice(4).join(' ') || undefined;
          const res = this.module.addRule({
            urlFilter: pattern,
            action: {
              type: 'block',
              statusCode: status,
              body,
            },
          });
          this.writeLine(
            `[INFO] Rule added: ${res.data.rule.id} (mock ${pattern} -> ${status}).`,
          );
        } else if (actionType === 'redirect') {
          const target = args[3];
          if (!target) {
            this.writeLine('[ERROR] Missing target URL for redirect rule.');
            return;
          }
          const res = this.module.addRule({
            urlFilter: pattern,
            action: {
              type: 'map_remote',
              urlRegex: pattern,
              replacement: target,
            },
          });
          this.writeLine(
            `[INFO] Rule added: ${res.data.rule.id} (redirect ${pattern} -> ${target}).`,
          );
        } else if (actionType === 'header') {
          const key = args[3];
          const val = args[4] ?? '';
          if (!key) {
            this.writeLine('[ERROR] Missing header key for header rule.');
            return;
          }
          const res = this.module.addRule({
            urlFilter: pattern,
            action: {
              type: 'modify_header',
              phase: 'request',
              set: {[key]: val},
            },
          });
          this.writeLine(
            `[INFO] Rule added: ${res.data.rule.id} (header ${key}: ${val}).`,
          );
        } else {
          this.writeLine(
            `[ERROR] Unknown rule action type: ${actionType}. Supported: mock, redirect, header.`,
          );
        }
        return;
      }
      case 'rm':
      case 'remove': {
        const id = args[1];
        if (!id) {
          this.writeLine('[ERROR] Usage: rule rm <ruleId>');
          return;
        }
        const res = this.module.removeRule({id});
        if (res.success) {
          this.writeLine(`[INFO] Rule ${id} removed.`);
        } else {
          this.writeLine(`[ERROR] Rule ${id} not found.`);
        }
        return;
      }
      case 'clear': {
        const res = this.module.clearRules();
        this.writeLine(`[INFO] Cleared ${res.data.clearedCount} rewrite rules.`);
        return;
      }
      default:
        this.writeLine(
          `[ERROR] Unknown rule subcommand: ${sub}. Use 'ls', 'add', 'rm', 'clear'.`,
        );
    }
  }

  handleFilter(args: string[]): void {
    if (args.length === 0) {
      this.writeLine(
        "[ERROR] Missing filter subcommand. Use 'filter ls', 'filter allow', 'filter block', 'filter rm', 'filter clear'.",
      );
      return;
    }

    const sub = args[0].toLowerCase();
    switch (sub) {
      case 'ls':
      case 'list': {
        const data = this.module.listHostFilters().data;
        this.writeLine('=== Host Filters ===');
        this.writeLine(`Allow list (${data.allow.length}):`);
        for (const h of data.allow) {
          this.writeLine(`  - ${h}`);
        }
        this.writeLine(`Block list (${data.block.length}):`);
        for (const h of data.block) {
          this.writeLine(`  - ${h}`);
        }
        return;
      }
      case 'allow': {
        const host = args[1];
        if (!host) {
          this.writeLine('[ERROR] Usage: filter allow <host>');
          return;
        }
        const res = this.module.addHostFilter({action: 'allow', host});
        if (res.success) {
          this.writeLine(`[INFO] Filter added: allow ${host}`);
        } else {
          this.writeLine(`[ERROR] Failed to add filter: ${res.message}`);
        }
        return;
      }
      case 'block': {
        const host = args[1];
        if (!host) {
          this.writeLine('[ERROR] Usage: filter block <host>');
          return;
        }
        const res = this.module.addHostFilter({action: 'block', host});
        if (res.success) {
          this.writeLine(`[INFO] Filter added: block ${host}`);
        } else {
          this.writeLine(`[ERROR] Failed to add filter: ${res.message}`);
        }
        return;
      }
      case 'rm':
      case 'remove': {
        const host = args[1];
        if (!host) {
          this.writeLine('[ERROR] Usage: filter rm <host>');
          return;
        }
        const r1 = this.module.removeHostFilter({action: 'allow', host});
        const r2 = this.module.removeHostFilter({action: 'block', host});
        if (r1.success || r2.success) {
          this.writeLine(`[INFO] Filter removed: ${host}`);
        } else {
          this.writeLine(`[ERROR] Filter not found: ${host}`);
        }
        return;
      }
      case 'clear': {
        const res = this.module.clearHostFilters();
        this.writeLine(`[INFO] Cleared ${res.data.clearedCount} host filters.`);
        return;
      }
      default:
        this.writeLine(
          `[ERROR] Unknown filter subcommand: ${sub}. Use 'ls', 'allow', 'block', 'rm', 'clear'.`,
        );
    }
  }

  async handleCa(args: string[]): Promise<void> {
    const sub = args[0]?.toLowerCase() ?? 'path';
    switch (sub) {
      case 'path': {
        const certPath = this.module.getCaManager().getCaCertPath();
        this.writeLine(`CA Root Certificate Path: ${certPath}`);
        this.writeLine('Manual Trust Commands:');
        this.writeLine(`  Windows: certutil -addstore -f "ROOT" "${certPath}"`);
        this.writeLine(
          `  macOS  : sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`,
        );
        this.writeLine(
          `  Linux  : sudo cp "${certPath}" /usr/local/share/ca-certificates/mitm-ca.crt && sudo update-ca-certificates`,
        );
        return;
      }
      case 'export': {
        const dest = args[1] ?? 'ca.crt';
        const res = await this.module.exportCa({outputPath: dest, format: 'pem'});
        if (res.success) {
          this.writeLine(`[INFO] CA certificate exported to ${dest}.`);
        } else {
          this.writeLine(`[ERROR] Failed to export CA certificate: ${res.message}`);
        }
        return;
      }
      default:
        this.writeLine(`[ERROR] Unknown ca subcommand: ${sub}. Use 'path' or 'export'.`);
    }
  }

  async handleSysproxy(args: string[]): Promise<void> {
    const sub = args[0]?.toLowerCase() ?? 'status';
    switch (sub) {
      case 'status': {
        const active = this.module.getSystemProxyManager().isActive();
        this.writeLine(`System proxy is currently ${active ? 'ENABLED' : 'DISABLED'}.`);
        return;
      }
      case 'on': {
        const status = this.module.status().data;
        if (!status.running || !status.port) {
          this.writeLine('[ERROR] Proxy server is not running. Start proxy first.');
          return;
        }
        try {
          await this.module.getSystemProxyManager().enable(status.port);
          this.writeLine(`[INFO] System proxy enabled on 127.0.0.1:${status.port}.`);
        } catch (err) {
          this.writeLine(
            `[ERROR] Failed to enable system proxy: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }
      case 'off': {
        try {
          await this.module.getSystemProxyManager().restore();
          this.writeLine('[INFO] System proxy disabled.');
        } catch (err) {
          this.writeLine(
            `[ERROR] Failed to disable system proxy: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }
      default:
        this.writeLine(
          `[ERROR] Unknown sysproxy subcommand: ${sub}. Use 'on', 'off', or 'status'.`,
        );
    }
  }

  async handleProc(args: string[]): Promise<void> {
    const sub = args[0]?.toLowerCase() ?? 'ls';
    switch (sub) {
      case 'ls':
      case 'list': {
        const res = await this.module.listLocalProcesses();
        const processes = res.data.processes;
        this.writeLine(`Local processes (${processes.length}):`);
        if (processes.length === 0) {
          this.writeLine('  No network processes detected.');
          return;
        }
        this.writeLine(`  ${'PID'.padEnd(8)} ${'NAME'.padEnd(25)} DISPLAY_NAME`);
        this.writeLine(`  ${'-'.repeat(50)}`);
        for (const p of processes) {
          this.writeLine(
            `  ${String(p.pid).padEnd(8)} ${p.name.padEnd(25)} ${p.displayName ?? '-'}`,
          );
        }
        return;
      }
      case 'target': {
        const target = args[1];
        if (!target) {
          this.writeLine('[ERROR] Usage: proc target <name|PID>');
          return;
        }
        await this.module.configureLocalApps({enabled: true, targets: [target]});
        this.writeLine(`[INFO] Targeted process traffic capture: ${target}`);
        return;
      }
      case 'clear': {
        await this.module.configureLocalApps({enabled: false, targets: []});
        this.writeLine('[INFO] Cleared process targets, capturing all traffic.');
        return;
      }
      default:
        this.writeLine(`[ERROR] Unknown proc subcommand: ${sub}. Use 'ls', 'target', or 'clear'.`);
    }
  }

  async handleHar(args: string[]): Promise<void> {
    const sub = args[0]?.toLowerCase() ?? 'export';
    let dest: string | undefined;
    if (sub === 'export') {
      dest = args[1];
    } else {
      dest = args[0];
    }

    if (!dest) {
      dest = `./artifacts/proxy-${Date.now()}.har`;
    }

    const res = await this.module.exportHar({outputPath: dest});
    if (res.success) {
      this.writeLine(`[INFO] HAR exported ${res.data.entryCount} entries to ${dest}.`);
    } else {
      this.writeLine(`[ERROR] Failed to export HAR: ${res.message}`);
    }
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
      case 'ls':
      case 'l':
      case 'list':
        this.handleLs(args);
        return true;
      case 'show':
      case 's':
        this.handleShow(args);
        return true;
      case 'curl':
      case 'c':
        await this.handleCurl(args);
        return true;
      case 'clear':
        this.handleClear();
        return true;
      case 'tail':
        this.handleTail(args);
        return true;
      case 'rule':
        this.handleRule(args);
        return true;
      case 'filter':
        this.handleFilter(args);
        return true;
      case 'ca':
        await this.handleCa(args);
        return true;
      case 'sysproxy':
        await this.handleSysproxy(args);
        return true;
      case 'proc':
        await this.handleProc(args);
        return true;
      case 'har':
        await this.handleHar(args);
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
    this.writeLine('  ls [limit] [filter]    List captured requests (alias: l, list)');
    this.writeLine('  show [id] [part]       Show request/response details (alias: s)');
    this.writeLine('  curl [id]              Generate curl replay command (alias: c)');
    this.writeLine('  tail [on|off]          Toggle or set real-time traffic streaming');
    this.writeLine('  rule ls                List rewrite rules');
    this.writeLine('  rule add <type> ...    Add rewrite rule (mock, redirect, header)');
    this.writeLine('  rule rm <id>           Remove rewrite rule');
    this.writeLine('  rule clear             Clear all rewrite rules');
    this.writeLine('  filter ls              List host filters (allow/block)');
    this.writeLine('  filter allow/block <h> Add host filter');
    this.writeLine('  filter rm <h>          Remove host filter');
    this.writeLine('  filter clear           Clear all host filters');
    this.writeLine('  sysproxy [on|off|stat] Control system proxy interception');
    this.writeLine('  ca [path|export]       Show root CA cert path or export cert');
    this.writeLine('  proc [ls|target|clear] Inspect/filter local processes');
    this.writeLine('  har [export] [path]    Export captured traffic to HAR file');
    this.writeLine('  clear                  Clear captured requests memory buffer');
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
