/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

interface FakeWriteStream {
  write(chunk: string): boolean;
  on(event: string, cb: (err: Error) => void): FakeWriteStream;
  end(cb?: () => void): void;
}

interface MutableFsModule {
  createWriteStream: typeof fs.createWriteStream;
}

interface MutableProcess {
  exit(code: number): never;
}

type ConsoleErrorFn = typeof console.error;

describe('root logger', {concurrency: false}, () => {
  it('does not create a default log file until the first log message', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalNodeEnv = process.env.NODE_ENV;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-reverse-logs-'));

    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.NODE_ENV = 'production';

    try {
      const imported = await import(
        `../../../src/utils/logger.js?lazy-default-log-${Date.now()}`
      );
      await imported.closeLogs();

      const logDir = path.join(dir, '.jsreverse', 'log');
      assert.ok(!fs.existsSync(logDir));
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      fs.rmSync(dir, {force: true, recursive: true});
    }
  });

  it('creates the default log file under ~/.jsreverse/log with a datetime name', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalNodeEnv = process.env.NODE_ENV;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-reverse-logs-'));

    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.NODE_ENV = 'production';

    try {
      const imported = await import(
        `../../../src/utils/logger.js?default-log-${Date.now()}`
      );

      imported.logger.info('default log file message');
      await imported.flushLogs();
      await imported.closeLogs();

      const logDir = path.join(dir, '.jsreverse', 'log');
      const files = fs.readdirSync(logDir);
      assert.strictEqual(files.length, 1);
      assert.match(
        files[0],
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/,
      );
      const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
      assert.ok(content.includes('default log file message'));
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      fs.rmSync(dir, {force: true, recursive: true});
    }
  });

  it('reuses the default datetime log file across logger loads in one service process', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalNodeEnv = process.env.NODE_ENV;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-reverse-logs-'));

    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.NODE_ENV = 'production';

    try {
      const first = await import(
        `../../../src/utils/logger.js?session-log-first-${Date.now()}`
      );
      first.logger.info('first session message');
      await first.flushLogs();

      const second = await import(
        `../../../src/utils/logger.js?session-log-second-${Date.now()}`
      );
      second.logger.info('second session message');
      await second.flushLogs();
      await second.closeLogs();

      const logDir = path.join(dir, '.jsreverse', 'log');
      const files = fs.readdirSync(logDir);
      assert.strictEqual(files.length, 1);
      assert.match(
        files[0],
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/,
      );
      const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
      assert.ok(content.includes('first session message'));
      assert.ok(content.includes('second session message'));
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      fs.rmSync(dir, {force: true, recursive: true});
    }
  });

  it('writes console messages to the default log file', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalNodeEnv = process.env.NODE_ENV;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-reverse-logs-'));

    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.NODE_ENV = 'production';

    try {
      const imported = await import(
        `../../../src/utils/logger.js?console-log-${Date.now()}`
      );

      console.log('plain console message', {toolName: 'console-test'});
      await imported.flushLogs();
      await imported.closeLogs();

      const logDir = path.join(dir, '.jsreverse', 'log');
      const [file] = fs.readdirSync(logDir);
      const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
      assert.ok(content.includes('plain console message'));
      assert.ok(content.includes('"toolName":"console-test"'));
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      fs.rmSync(dir, {force: true, recursive: true});
    }
  });

  it('saves debug logs to a file', async () => {
    const {closeLogs, logger, saveLogsToFile} =
      await import('../../../src/utils/logger.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-logger-'));
    fs.mkdirSync(dir, {recursive: true});

    const file = path.join(dir, `log-${Date.now()}.txt`);
    const stream = saveLogsToFile(file);

    logger.info('hello from logger test');

    await new Promise<void>(resolve => {
      stream.end(() => resolve());
    });
    await closeLogs();

    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(content.includes('hello from logger test'));
    fs.rmSync(dir, {force: true, recursive: true});
  });

  it('handles write stream error callback by ending stream and exiting', async () => {
    const {closeLogs, saveLogsToFile} =
      await import('../../../src/utils/logger.js');
    const originalCreate = fs.createWriteStream;
    const originalExit = process.exit;
    const originalConsoleError = console.error;

    let errorHandler: ((err: Error) => void) | null = null;
    let endCalled = 0;
    const fakeStream: FakeWriteStream = {
      write: () => true,
      on: (event: string, cb: (err: Error) => void) => {
        if (event === 'error') {
          errorHandler = cb;
        }
        return fakeStream;
      },
      end: (cb?: () => void) => {
        endCalled += 1;
        cb?.();
      },
    };

    (fs as unknown as MutableFsModule).createWriteStream = () =>
      fakeStream as unknown as ReturnType<typeof fs.createWriteStream>;
    let exitCode: number | null = null;
    (process as unknown as MutableProcess).exit = (code: number) => {
      exitCode = code;
      throw new Error('__exit_called__');
    };
    let errorLogged = '';
    console.error = ((msg?: unknown) => {
      errorLogged = String(msg ?? '');
    }) as ConsoleErrorFn;

    try {
      saveLogsToFile('/tmp/fake-log.txt');
      assert.ok(errorHandler);
      assert.throws(
        () => errorHandler!(new Error('disk full')),
        /__exit_called__/,
      );
      assert.strictEqual(endCalled, 1);
      assert.strictEqual(exitCode, 1);
      assert.ok(errorLogged.includes('Error when opening/writing to log file'));
    } finally {
      (fs as unknown as MutableFsModule).createWriteStream = originalCreate;
      (process as unknown as MutableProcess).exit =
        originalExit as unknown as MutableProcess['exit'];
      console.error = originalConsoleError;
      await closeLogs();
    }
  });

  it('serializes structured fields in log output', async () => {
    const {closeLogs, logger} = await import('../../../src/utils/logger.js');
    const originalConsoleError = console.error;
    let output = '';
    console.error = ((msg?: unknown) => {
      output = String(msg ?? '');
    }) as ConsoleErrorFn;

    try {
      logger.info('tool.completed', {toolName: 'x'});
    } finally {
      console.error = originalConsoleError;
      await closeLogs();
    }

    assert.ok(output.includes('tool.completed'));
    assert.ok(output.includes('"toolName":"x"'));
  });
});
