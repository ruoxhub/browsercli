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

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
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

  async handleCommand(rawLine: string): Promise<boolean> {
    const tokens = tokenizeLine(rawLine.trim());
    if (tokens.length === 0) return true;

    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    switch (cmd) {
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
    this.writeLine('  help [cmd]             Show help message');
    this.writeLine('  exit / quit / q        Exit CLI');
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: this.input as Readable,
      output: this.output as Writable,
      prompt: 'proxy[stopped]> ',
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
