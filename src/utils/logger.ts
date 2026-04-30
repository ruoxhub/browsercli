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

import chalk from 'chalk';

import {getEnvValue} from '../config.js';

import {safeStringify} from './safeJson.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel;

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
    this.fileStream?.write(`${formatted}\n`);

    // 控制台输出（带颜色）
    const colorFn: Record<LogLevel, (text: string) => string> = {
      debug: chalk.gray,
      info: chalk.blue,
      warn: chalk.yellow,
      error: chalk.red,
    };
    console.error(colorFn[level](formatted));
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
      this.fileStream?.write(`${formatted}\n`);
      console.error(chalk.green(formatted));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 将日志写入指定文件，同时保留控制台输出。
   * 替代原 src/logger.ts 中基于 debug 库的 saveLogsToFile。
   */
  saveLogsToFile(fileName: string): fs.WriteStream {
    const stream = fs.createWriteStream(fileName, {flags: 'a+'});
    stream.on('error', (error: Error) => {
      console.error(
        `Error when opening/writing to log file: ${error.message}`,
      );
      stream.end();
      process.exit(1);
    });
    this.fileStream = stream;
    return stream;
  }
}

function parseLogLevel(value: string | undefined): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (value && validLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return 'info';
}

export const logger = new Logger(parseLogLevel(getEnvValue('LOG_LEVEL')));

/**
 * 将日志保存到文件的便捷函数。
 * 兼容原 src/logger.ts 的 saveLogsToFile 接口。
 */
export function saveLogsToFile(fileName: string): fs.WriteStream {
  return logger.saveLogsToFile(fileName);
}
