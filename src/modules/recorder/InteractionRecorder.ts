/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from 'patchright';

export interface RecordedUserInteraction {
  id: string;
  type: 'click' | 'input' | 'keydown' | 'change';
  target: {
    tagName: string;
    id?: string;
    className?: string;
    role?: string;
    name?: string;
    value?: string;
    selector?: string;
  };
  timestamp: number;
}

export interface NetworkEvidence {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  timestamp: number;
  initiatorType?: string;
}

export interface OperationEvidence {
  recordingId: string;
  startedAt: number;
  stoppedAt: number;
  interactions: RecordedUserInteraction[];
  correlatedNetwork: NetworkEvidence[];
}

export class InteractionRecorder {
  private active = false;
  private recordingId = '';
  private startedAt = 0;
  private recordedInteractions: RecordedUserInteraction[] = [];
  private cleanupBinding?: () => Promise<void>;

  isActive(): boolean {
    return this.active;
  }

  async start(page: Page): Promise<string> {
    if (this.active) {
      throw new Error(
        `Recording is already active with ID "${this.recordingId}". Call record_stop first.`,
      );
    }

    this.recordingId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.startedAt = Date.now();
    this.recordedInteractions = [];
    this.active = true;

    // 暴露页面到 Node.js 的桥接函数
    const bindingName = `__browsercli_record_interaction__`;
    try {
      await page.exposeFunction(
        bindingName,
        (interaction: RecordedUserInteraction) => {
          if (this.active) {
            this.recordedInteractions.push(interaction);
          }
        },
      );
    } catch {
      // 函数可能已被暴露过，忽略冲突
    }

    // 页面端监听捕获
    await page.evaluate(fnName => {
      const listener = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const tag = target.tagName.toLowerCase();
        const role = target.getAttribute('role') || undefined;
        const name =
          target.getAttribute('aria-label') ||
          target.getAttribute('title') ||
          (target.childElementCount === 0
            ? target.textContent?.trim().slice(0, 50)
            : undefined);

        const val =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
            ? target.value
            : undefined;

        let selector: string | undefined;
        if (target.id) {
          selector = `#${CSS.escape(target.id)}`;
        } else if (name) {
          selector = `[aria-label="${CSS.escape(name)}"]`;
        }

        const data = {
          id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          type: event.type,
          target: {
            tagName: tag,
            id: target.id || undefined,
            className: target.className || undefined,
            role,
            name,
            value: val,
            selector,
          },
          timestamp: Date.now(),
        };

        const bridge = (window as any)[fnName];
        if (typeof bridge === 'function') {
          bridge(data);
        }
      };

      window.addEventListener('click', listener, {
        capture: true,
        passive: true,
      });
      window.addEventListener('change', listener, {
        capture: true,
        passive: true,
      });
      window.addEventListener('input', listener, {
        capture: true,
        passive: true,
      });
      (window as any).__browsercli_remove_listeners__ = () => {
        window.removeEventListener('click', listener, {capture: true} as any);
        window.removeEventListener('change', listener, {capture: true} as any);
        window.removeEventListener('input', listener, {capture: true} as any);
      };
    }, bindingName);

    this.cleanupBinding = async () => {
      try {
        await page.evaluate(() => {
          (window as any).__browsercli_remove_listeners__?.();
        });
      } catch {
        // ignore page closed
      }
    };

    return this.recordingId;
  }

  async stop(
    correlatedNetwork: NetworkEvidence[] = [],
  ): Promise<OperationEvidence> {
    if (!this.active) {
      throw new Error('No recording is currently active.');
    }

    const stoppedAt = Date.now();
    this.active = false;

    if (this.cleanupBinding) {
      await this.cleanupBinding();
      this.cleanupBinding = undefined;
    }

    const evidence: OperationEvidence = {
      recordingId: this.recordingId,
      startedAt: this.startedAt,
      stoppedAt,
      interactions: [...this.recordedInteractions],
      correlatedNetwork: correlatedNetwork.filter(
        req =>
          req.timestamp >= this.startedAt && req.timestamp <= stoppedAt + 1000,
      ),
    };

    return evidence;
  }
}

export const globalInteractionRecorder = new InteractionRecorder();
