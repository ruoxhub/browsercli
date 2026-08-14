/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

import {assessCaptchaSnapshot} from './rules.js';
import type {
  CaptchaAssessment,
  CaptchaPageSnapshot,
  CaptchaWaitResult,
} from './types.js';

const ASSESS_TIMEOUT_MS = 5000;
const MAX_BODY_TEXT_LENGTH = 4000;
const MAX_ELEMENTS = 32;
const MAX_ATTRIBUTE_LENGTH = 256;
const MAX_SRC_LENGTH = 2048;

const CANDIDATE_SELECTOR = [
  '[data-sitekey]',
  '[role="slider"]',
  '[draggable="true"]',
  '[id*="captcha" i]',
  '[class*="captcha" i]',
  '[id*="challenge" i]',
  '[class*="challenge" i]',
  '[aria-label*="captcha" i]',
  '[aria-label*="challenge" i]',
  '[title*="captcha" i]',
  '[title*="challenge" i]',
  '[id*="browser-check" i]',
  '[class*="browser-check" i]',
  '[id*="security-check" i]',
  '[class*="security-check" i]',
  'iframe[src*="captcha" i]',
  'iframe[src*="challenge" i]',
  'iframe[title*="human" i]',
  'iframe[title*="verify" i]',
  'img[alt*="captcha" i]',
  'img[alt*="challenge" i]',
].join(',');

interface SnapshotOptions {
  candidateSelector: string;
  maxBodyTextLength: number;
  maxElements: number;
  maxAttributeLength: number;
  maxSrcLength: number;
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DEFAULT_WAIT_TIMEOUT_MS = 300000;
const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_TRANSIENT_ERRORS = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientNavigationError(error: unknown): boolean {
  return /execution context.*destroyed|cannot find context|frame.*detached/i.test(
    errorMessage(error),
  );
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}
export class CaptchaDetector {
  async assess(page: Page): Promise<CaptchaAssessment> {
    return this.assessWithinDeadline(page, ASSESS_TIMEOUT_MS);
  }

  private async assessWithinDeadline(
    page: Page,
    timeoutMs: number,
  ): Promise<CaptchaAssessment> {
    if (page.isClosed()) {
      throw new Error('Target page, context or browser has been closed');
    }
    const url = page.url();

    const reads = Promise.all([
      page.title(),
      page.evaluate(
        (options: SnapshotOptions): CaptchaPageSnapshot => {
          const clip = (value: string | null, limit: number) =>
            (value ?? '').slice(0, limit);
          const isVisible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return (
              element.isConnected &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.visibility !== 'collapse' &&
              Number.parseFloat(style.opacity) > 0
            );
          };

          // ponytail: Inspect only the top-level DOM and iframe metadata; add explicit
          // frame/shadow traversal only after a reproducible miss demonstrates the need.
          const elements = Array.from(
            document.querySelectorAll(options.candidateSelector),
          )
            .slice(0, options.maxElements)
            .map(element => {
              const tagName = element.tagName.toLowerCase();
              const isIframe = tagName === 'iframe';
              return {
                tagName,
                id: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('id'),
                      options.maxAttributeLength,
                    ),
                className: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('class'),
                      options.maxAttributeLength,
                    ),
                role: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('role'),
                      options.maxAttributeLength,
                    ),
                ariaLabel: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('aria-label'),
                      options.maxAttributeLength,
                    ),
                src: clip(element.getAttribute('src'), options.maxSrcLength),
                title: clip(
                  element.getAttribute('title'),
                  options.maxAttributeLength,
                ),
                alt: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('alt'),
                      options.maxAttributeLength,
                    ),
                visible: isVisible(element),
                hasSiteKey: !isIframe && element.hasAttribute('data-sitekey'),
                draggable:
                  !isIframe &&
                  (element.getAttribute('draggable') === 'true' ||
                    (element as {draggable?: boolean}).draggable === true),
              };
            });

          return {
            bodyText: (document.body?.innerText ?? '').slice(
              0,
              options.maxBodyTextLength,
            ),
            elements,
          };
        },
        {
          candidateSelector: CANDIDATE_SELECTOR,
          maxBodyTextLength: MAX_BODY_TEXT_LENGTH,
          maxElements: MAX_ELEMENTS,
          maxAttributeLength: MAX_ATTRIBUTE_LENGTH,
          maxSrcLength: MAX_SRC_LENGTH,
        },
      ),
    ]);
    const [title, snapshot] = await withDeadline(
      reads,
      timeoutMs,
      () => new Error('CAPTCHA assessment timed out after ' + timeoutMs + 'ms'),
    );

    return assessCaptchaSnapshot({url, title, snapshot});
  }
  async waitForClear(
    page: Page,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<CaptchaWaitResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive integer');
    }

    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let checks = 0;
    let clearStreak = 0;
    let challengeObserved = false;
    let consecutiveTransientErrors = 0;
    let lastAssessment: CaptchaAssessment | undefined;

    const timedOut = (): CaptchaWaitResult => {
      if (!lastAssessment) {
        throw new Error(
          'CAPTCHA wait timed out before a successful assessment',
        );
      }
      return {
        cleared: false,
        elapsedMs: Date.now() - startedAt,
        checks,
        assessment: lastAssessment,
      };
    };

    while (true) {
      if (page.isClosed()) {
        throw new Error('Target page, context or browser has been closed');
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return timedOut();

      checks++;
      try {
        const assessment = await this.assessWithinDeadline(
          page,
          Math.min(ASSESS_TIMEOUT_MS, remaining),
        );
        lastAssessment = assessment;
        consecutiveTransientErrors = 0;

        if (assessment.status === 'not_detected') {
          if (!challengeObserved) {
            return {
              cleared: true,
              elapsedMs: Date.now() - startedAt,
              checks,
              assessment,
            };
          }
          clearStreak++;
          if (clearStreak === 2) {
            return {
              cleared: true,
              elapsedMs: Date.now() - startedAt,
              checks,
              assessment,
            };
          }
        } else {
          challengeObserved = true;
          clearStreak = 0;
        }
      } catch (error) {
        if (page.isClosed()) {
          throw new Error('Target page, context or browser has been closed');
        }
        if (Date.now() >= deadline) return timedOut();
        if (!isTransientNavigationError(error)) throw error;

        clearStreak = 0;
        consecutiveTransientErrors++;
        if (consecutiveTransientErrors > MAX_CONSECUTIVE_TRANSIENT_ERRORS) {
          throw error;
        }
      }

      const sleepBudget = deadline - Date.now();
      if (sleepBudget <= 0) return timedOut();
      await delay(Math.min(POLL_INTERVAL_MS, sleepBudget));
    }
  }
}
