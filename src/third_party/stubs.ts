/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Mock objects for chrome-devtools-frontend runtime values
// These are stub implementations to satisfy type checking after removing the dependency

/* eslint-disable @typescript-eslint/no-namespace */

export namespace Common {
  export class ObjectWrapper<T = unknown> {
    emit(_event: string, _data?: T): void {
      /* no-op */
    }
    addEventListener(
      _event: string,
      _listener: (...args: unknown[]) => void,
    ): void {
      /* no-op */
    }
    removeEventListener(
      _event: string,
      _listener: (...args: unknown[]) => void,
    ): void {
      /* no-op */
    }
  }

  // EventTarget 类型 - 用于 modules/collector/PageCollector.ts
  export namespace EventTarget {
    export interface EventTargetEvent<T> {
      data: T;
    }
  }
}

export namespace Marked {
  export const Marked = {
    lexer: (_markdown: string): unknown[] => [],
  };
}

export namespace MarkdownIssueDescription {
  export const substitutePlaceholders = (
    _markdown: string,
    _subs: Record<string, unknown>,
  ): string => _markdown;
  export const findTitleFromMarkdownAst = (_ast: unknown): string | null =>
    null;
}

export namespace I18n {
  export namespace DevToolsLocale {
    export const DevToolsLocale = {
      instance: (_opts: {create: boolean; data: unknown}): unknown => ({}),
    };
  }
  export const i18n = {
    registerLocaleDataForTest: (_locale: string, _data: unknown): void => {
      /* no-op */
    },
  };
}

// PipeTransport - not available in Playwright, provide stub
export const PipeTransport = class PipeTransport {
  // Stub - Playwright uses different transport mechanisms
};
