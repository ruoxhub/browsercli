/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createCDPSessionFrom,
  type CDPSessionLike,
} from './CDPSessionAdapter.js';
import {isRecord} from './isRecord.js';

interface V8VersionResponse {
  product?: unknown;
  jsVersion?: unknown;
}

interface RuntimeEvaluateResponse {
  result?: unknown;
}

export interface V8Version {
  major: number;
  minor: number;
  patch: number;
  commit: string;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readBooleanResult(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (isRecord(value)) {
    const nested = value['value'];
    return typeof nested === 'boolean' ? nested : false;
  }
  return false;
}

export class VersionDetector {
  constructor(private readonly getPage?: () => Promise<unknown>) {}

  async detectV8Version(): Promise<V8Version | null> {
    const browserVersion = await this.detectBrowserVersion();
    if (browserVersion) {
      return browserVersion;
    }

    if (
      typeof process.versions.v8 === 'string' &&
      process.versions.v8.length > 0
    ) {
      return this.parseV8Version(process.versions.v8);
    }

    return null;
  }

  parseV8Version(versionString: string): V8Version {
    const match =
      /(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:\.(?<commit>[A-Za-z0-9._-]+))?/u.exec(
        versionString.trim(),
      );

    if (!match?.groups) {
      return {major: 0, minor: 0, patch: 0, commit: ''};
    }

    const major = Number(match.groups['major'] ?? 0);
    const minor = Number(match.groups['minor'] ?? 0);
    const patch = Number(match.groups['patch'] ?? 0);

    return {
      major: Number.isFinite(major) ? major : 0,
      minor: Number.isFinite(minor) ? minor : 0,
      patch: Number.isFinite(patch) ? patch : 0,
      commit: match.groups['commit'] ?? '',
    };
  }

  async supportsNativesSyntax(): Promise<boolean> {
    if (process.execArgv.includes('--allow-natives-syntax')) {
      return true;
    }

    const session = await this.createSession();
    if (!session) {
      return false;
    }

    try {
      const response = await session.send<RuntimeEvaluateResponse>(
        'Runtime.evaluate',
        {
          expression: `
          (() => {
            try {
              return Boolean(new Function("return %HaveSameMap({}, {})")());
            } catch (error) {
              return false;
            }
          })()
        `,
          returnByValue: true,
          awaitPromise: false,
        },
      );

      if (!isRecord(response)) {
        return false;
      }
      return readBooleanResult(response['result']);
    } catch {
      return false;
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  private async detectBrowserVersion(): Promise<V8Version | null> {
    const session = await this.createSession();
    if (!session) {
      return null;
    }

    try {
      const response =
        await session.send<V8VersionResponse>('Browser.getVersion');
      if (!isRecord(response)) {
        return null;
      }

      const jsVersion = readString(response, 'jsVersion');
      if (jsVersion) {
        return this.parseV8Version(jsVersion);
      }

      const product = readString(response, 'product');
      return product ? this.parseV8Version(product) : null;
    } catch {
      return null;
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  private async createSession(): Promise<CDPSessionLike | null> {
    return createCDPSessionFrom(this.getPage);
  }
}
