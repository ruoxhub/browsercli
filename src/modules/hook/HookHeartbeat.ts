
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {Page} from 'patchright';

const DEBOUNCE_MS = 150;
const INJECT_TIMEOUT_MS = 10_000;

export class HookHeartbeat {
  private readonly page: Page;
  private readonly hookScript: string;
  private debounceTimer: NodeJS.Timeout | undefined;
  private active = false;
  private readonly onNavigated: () => void;
  private readonly onClose: () => void;

  constructor(page: Page, hookScript: string) {
    this.page = page;
    this.hookScript = hookScript;

    this.onNavigated = () => {
      if (!this.active) return;
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.inject(), DEBOUNCE_MS);
    };

    this.onClose = () => {
      this.stop();
    };
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.page.on('framenavigated', this.onNavigated);
    this.page.once('close', this.onClose);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.debounceTimer);
    this.page.off('framenavigated', this.onNavigated);
    this.page.off('close', this.onClose);
  }

  isActive(): boolean {
    return this.active;
  }

  private async inject(): Promise<void> {
    if (!this.active || this.page.isClosed()) return;
    try {
      await Promise.race([
        this.page.evaluate(this.hookScript),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Hook injection timeout')), INJECT_TIMEOUT_MS),
        ),
      ]);
    } catch {
      // Page closed or timeout — silently ignore
    }
  }
}
