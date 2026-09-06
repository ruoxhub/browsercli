/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 统一日志工具
 *
 * 合并了原 src/logger.ts（基于 debug 库）与 src/utils/logger.ts（自定义 Logger 类）的功能。
 * - Logger 类提供分级、彩色控制台输出
 * - saveLogsToFile 支持将日志写入文件
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import chalk from 'chalk';

import {safeStringify} from './safeJson.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type ConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn';

interface LoggerConsoleState {
  defaultLogFileName: string | null;
  defaultLogHome: string | null;
  defaultLoggingEnabled: boolean;
  fileStream: fs.WriteStream | null;
  installed: boolean;
  original: Record<ConsoleMethod, (...args: unknown[]) => void>;
  writingFromLogger: boolean;
}

const LOGGER_CONSOLE_STATE = Symbol.for('browser.logger.consoleState');

function getConsoleState(): LoggerConsoleState {
  const globalWithState = globalThis as typeof globalThis & {
    [LOGGER_CONSOLE_STATE]?: LoggerConsoleState;
  };
  if (!globalWithState[LOGGER_CONSOLE_STATE]) {
    globalWithState[LOGGER_CONSOLE_STATE] = {
      defaultLogFileName: null,
      defaultLogHome: null,
      defaultLoggingEnabled: false,
      fileStream: null,
      installed: false,
      original: {
        debug: console.debug.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console),
        log: console.log.bind(console),
        warn: console.warn.bind(console),
      },
      writingFromLogger: false,
    };
  }
  return globalWithState[LOGGER_CONSOLE_STATE];
}

/**
 * 默认日志目录：~/.proxycli/log。
 *
 * 纯函数 —— 不参与 `defaultLogHome` 状态判断。导出供 Web 控制台展示
 * （`GET /api/system/info`）与写入共用同一份定义，避免两处目录字面量各自漂移。
 */
export function getLogDir(): string {
  return path.join(os.homedir(), '.proxycli', 'log');
}

function createDefaultLogFileName(now = new Date()): string {
  const state = getConsoleState();
  const home = os.homedir();
  if (!state.defaultLogFileName || state.defaultLogHome !== home) {
    const datetime = now.toISOString().replace(/[:.]/g, '-');
    state.defaultLogHome = home;
    state.defaultLogFileName = path.join(getLogDir(), `${datetime}.log`);
  }
  return state.defaultLogFileName;
}

function formatConsoleArg(arg: unknown): string {
  return typeof arg === 'string' ? arg : safeStringify(arg);
}

function formatConsoleMessage(method: ConsoleMethod, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const level = method === 'log' ? 'INFO' : method.toUpperCase();
  return `[${timestamp}] [${level}] ${args.map(formatConsoleArg).join(' ')}`;
}

function openLogFile(fileName: string): fs.WriteStream {
  fs.mkdirSync(path.dirname(fileName), {recursive: true});
  const stream = fs.createWriteStream(fileName, {flags: 'a+'});
  stream.on('error', (error: Error) => {
    console.error(`Error when opening/writing to log file: ${error.message}`);
    stream.end();
    process.exit(1);
  });
  return stream;
}

function ensureDefaultFileStream(): fs.WriteStream | null {
  const state = getConsoleState();
  if (state.fileStream) {
    return state.fileStream;
  }
  if (!state.defaultLoggingEnabled) {
    return null;
  }
  state.fileStream = openLogFile(createDefaultLogFileName());
  return state.fileStream;
}

function writeConsoleLog(method: ConsoleMethod, args: unknown[]): void {
  ensureDefaultFileStream()?.write(`${formatConsoleMessage(method, args)}\n`);
}

function installConsoleFileBridge(): void {
  const state = getConsoleState();
  if (state.installed) {
    return;
  }

  const methods: ConsoleMethod[] = ['debug', 'error', 'info', 'log', 'warn'];
  for (const method of methods) {
    console[method] = ((...args: unknown[]) => {
      if (!state.writingFromLogger) {
        writeConsoleLog(method, args);
      }
      state.original[method](...args);
    }) as (typeof console)[typeof method];
  }
  state.installed = true;
}

export class Logger {
  level: LogLevel;

  private fileStream: fs.WriteStream | null = null;

  private static readonly LEVELS: LogLevel[] = [
    'debug',
    'info',
    'warn',
    'error',
  ];

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return Logger.LEVELS.indexOf(level) >= Logger.LEVELS.indexOf(this.level);
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    ...args: unknown[]
  ): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const formattedArgs = args.length > 0 ? ' ' + safeStringify(args) : '';
    return `${prefix} ${message}${formattedArgs}`;
  }

  private emit(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(level, message, ...args);

    // 写入文件流（无颜色）
    const stream = this.fileStream ?? ensureDefaultFileStream();
    stream?.write(`${formatted}\n`);
    if (!this.fileStream && stream) {
      this.fileStream = stream;
    }

    // 控制台输出（带颜色）
    const colorFn: Record<LogLevel, (text: string) => string> = {
      debug: chalk.gray,
      info: chalk.blue,
      warn: chalk.yellow,
      error: chalk.red,
    };
    const state = getConsoleState();
    state.writingFromLogger = true;
    try {
      console.error(colorFn[level](formatted));
    } finally {
      state.writingFromLogger = false;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.emit('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.emit('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.emit('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.emit('error', message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message, ...args);
      const stream = this.fileStream ?? ensureDefaultFileStream();
      stream?.write(`${formatted}\n`);
      if (!this.fileStream && stream) {
        this.fileStream = stream;
      }
      const state = getConsoleState();
      state.writingFromLogger = true;
      try {
        console.error(chalk.green(formatted));
      } finally {
        state.writingFromLogger = false;
      }
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  useFileStream(stream: fs.WriteStream): void {
    this.fileStream = stream;
  }

  /**
   * 将日志写入指定文件，同时保留控制台输出。
   * 替代原 src/logger.ts 中基于 debug 库的 saveLogsToFile。
   */
  saveLogsToFile(fileName: string): fs.WriteStream {
    this.fileStream?.end();
    const stream = openLogFile(fileName);
    this.fileStream = stream;
    getConsoleState().fileStream = stream;
    return stream;
  }

  close(): Promise<void> {
    const stream = this.fileStream;
    if (!stream) {
      return Promise.resolve();
    }
    this.fileStream = null;
    const state = getConsoleState();
    if (state.fileStream === stream) {
      state.fileStream = null;
    }
    return new Promise(resolve => {
      stream.end(() => resolve());
    });
  }

  flush(): Promise<void> {
    if (!this.fileStream) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.fileStream?.write('', error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function parseLogLevel(value: string | undefined): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (value && validLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return 'info';
}

export const logger = new Logger(parseLogLevel(process.env.LOG_LEVEL));

if (process.env.NODE_ENV !== 'test') {
  installConsoleFileBridge();
  const state = getConsoleState();
  state.defaultLoggingEnabled = true;
  if (state.fileStream) {
    logger.useFileStream(state.fileStream);
  }
}

/**
 * 将日志保存到文件的便捷函数。
 * 兼容原 src/logger.ts 的 saveLogsToFile 接口。
 */
export function saveLogsToFile(fileName: string): fs.WriteStream {
  installConsoleFileBridge();
  return logger.saveLogsToFile(fileName);
}

export function flushLogs(): Promise<void> {
  return logger.flush();
}

export function closeLogs(): Promise<void> {
  return logger.close();
}
