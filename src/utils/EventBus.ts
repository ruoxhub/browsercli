/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 类型安全的应用事件总线。
 *
 * @see {@link src/runtime.ts} — 在 getRuntime() 中创建全局 EventBus 实例
 * @see {@link src/types/events.ts} — AppEventMap 事件类型定义
 * @see {@link src/web/ConsoleServer.ts} — 订阅事件桥接到 WebSocket
 * @see {@link src/modules/hook/HookManager.ts} — 通过 EventBus 发布 hook 状态变更
 */

type EventHandler<T> = (payload: T) => void | Promise<void>;
type EventValidator<T> = (payload: unknown) => T;
type EventValidators<TMap extends object> = Partial<{
  [K in keyof TMap]: EventValidator<TMap[K]>;
}>;

export interface EventBusOptions<TMap extends object> {
  validators?: EventValidators<TMap>;
  validateOnEmit?: boolean;
}

export class EventBus<TMap extends object> {
  private handlers = new Map<keyof TMap, Set<EventHandler<unknown>>>();
  private readonly validators: EventValidators<TMap>;
  private readonly validateOnEmit: boolean;

  constructor(options: EventBusOptions<TMap> = {}) {
    this.validators = options.validators ?? {};
    this.validateOnEmit = options.validateOnEmit ?? true;
  }

  on<K extends keyof TMap>(
    event: K,
    handler: EventHandler<TMap[K]>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const validatedPayload = this.validatePayload(event, payload);
    this.handlers.get(event)?.forEach(handler => {
      void handler(validatedPayload);
    });
  }

  async emitAsync<K extends keyof TMap>(
    event: K,
    payload: TMap[K],
  ): Promise<void> {
    const validatedPayload = this.validatePayload(event, payload);
    const handlers = [...(this.handlers.get(event) ?? [])];
    const results = await Promise.allSettled(
      handlers.map(handler => handler(validatedPayload)),
    );

    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }
  }

  private validatePayload<K extends keyof TMap>(
    event: K,
    payload: TMap[K],
  ): TMap[K] {
    if (!this.validateOnEmit) return payload;
    const validator = this.validators[event];
    if (!validator) return payload;
    try {
      return validator(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid event payload for "${String(event)}": ${message}`,
      );
    }
  }
}
