/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {isRecord} from './isRecord.js';

export interface CDPSessionLike {
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  detach(): Promise<void>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

function isCDPSessionLike(value: unknown): value is CDPSessionLike {
  return (
    isRecord(value) &&
    typeof value['send'] === 'function' &&
    typeof value['detach'] === 'function'
  );
}

/** Create a CDP session from the current project's Patchright Page contract. */
export async function createCDPSession(
  page: unknown,
): Promise<CDPSessionLike | null> {
  if (!isRecord(page)) return null;

  try {
    const getContext = page['context'];
    if (typeof getContext === 'function') {
      const context = getContext.call(page) as unknown;
      if (isRecord(context) && typeof context['newCDPSession'] === 'function') {
        const session = (await context['newCDPSession'].call(
          context,
          page,
        )) as unknown;
        return isCDPSessionLike(session) ? session : null;
      }
    }

    // Preserve compatibility with the upstream Puppeteer-shaped adapter.
    const createLegacySession = page['createCDPSession'];
    if (typeof createLegacySession === 'function') {
      const session = (await createLegacySession.call(page)) as unknown;
      return isCDPSessionLike(session) ? session : null;
    }
  } catch {
    return null;
  }

  return null;
}

export async function createCDPSessionFrom(
  getPage?: () => Promise<unknown>,
): Promise<CDPSessionLike | null> {
  if (!getPage) return null;

  try {
    return await createCDPSession(await getPage());
  } catch {
    return null;
  }
}
