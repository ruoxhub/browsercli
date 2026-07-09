/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * EventBreakpointManager - 事件监听器断点管理
 *
 * 功能:
 * 1. 设置事件监听器断点(按事件类型)
 * 2. 在事件触发时暂停执行
 * 3. 支持预定义的事件类别(鼠标、键盘、定时器等)
 *
 * 设计原则:
 * - 使用 CDP DOMDebugger.setEventListenerBreakpoint
 * - 提供常用事件类别的快捷方法
 * - 支持自定义事件名称
 */

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

export interface EventBreakpoint {
  id: string;
  eventName: string;
  targetName?: string;
  enabled: boolean;
  hitCount: number;
  createdAt: number;
}

const INSTRUMENTATION_TARGET = '__instrumentation__';

/**
 * 事件断点管理器
 *
 * 重构:使用共享的 CDP session,不再创建独立 session
 */
export class EventBreakpointManager {
  private eventBreakpoints = new Map<string, EventBreakpoint>();
  private breakpointCounter = 0;

  static readonly MOUSE_EVENTS = [
    'click',
    'dblclick',
    'mousedown',
    'mouseup',
    'mousemove',
    'mouseenter',
    'mouseleave',
  ];
  static readonly KEYBOARD_EVENTS = ['keydown', 'keyup', 'keypress'];
  /** Timer 使用 Instrumentation Breakpoint(非 DOM 事件) */
  static readonly TIMER_INSTRUMENTATION_EVENTS = [
    'TimerInstall',
    'TimerFire',
    'AnimationFrameFired',
  ];
  static readonly WEBSOCKET_EVENTS = ['message', 'open', 'close', 'error'];

  constructor(private getSession: () => CDPSession) {
    logger.info('EventBreakpointManager initialized with shared CDP session');
  }

  async setEventListenerBreakpoint(
    eventName: string,
    targetName?: string,
  ): Promise<string> {
    await this.getSession().send('DOMDebugger.setEventListenerBreakpoint', {
      eventName,
      targetName,
    });

    const breakpointId = `event_${++this.breakpointCounter}`;
    this.eventBreakpoints.set(breakpointId, {
      id: breakpointId,
      eventName,
      targetName,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    });

    logger.info(`Event listener breakpoint set: ${eventName}`, {
      breakpointId,
      targetName,
    });
    return breakpointId;
  }

  async removeEventListenerBreakpoint(breakpointId: string): Promise<boolean> {
    const breakpoint = this.eventBreakpoints.get(breakpointId);
    if (!breakpoint) {
      return false;
    }

    await this.sendRemoveBreakpoint(breakpoint);
    this.eventBreakpoints.delete(breakpointId);
    logger.info(`Event listener breakpoint removed: ${breakpointId}`);
    return true;
  }

  private async sendRemoveBreakpoint(breakpoint: EventBreakpoint): Promise<void> {
    if (breakpoint.targetName === INSTRUMENTATION_TARGET) {
      await this.getSession().send('DOMDebugger.removeInstrumentationBreakpoint', {
        eventName: breakpoint.eventName,
      });
    } else {
      await this.getSession().send('DOMDebugger.removeEventListenerBreakpoint', {
        eventName: breakpoint.eventName,
        targetName: breakpoint.targetName,
      });
    }
  }

  async setMouseEventBreakpoints(): Promise<string[]> {
    return this.setBatchBreakpoints(EventBreakpointManager.MOUSE_EVENTS, 'mouse');
  }

  async setKeyboardEventBreakpoints(): Promise<string[]> {
    return this.setBatchBreakpoints(
      EventBreakpointManager.KEYBOARD_EVENTS,
      'keyboard',
    );
  }

  async setTimerEventBreakpoints(): Promise<string[]> {
    const breakpointIds: string[] = [];
    for (const event of EventBreakpointManager.TIMER_INSTRUMENTATION_EVENTS) {
      try {
        await this.getSession().send(
          'DOMDebugger.setInstrumentationBreakpoint',
          {eventName: event},
        );

        const breakpointId = `event_${++this.breakpointCounter}`;
        this.eventBreakpoints.set(breakpointId, {
          id: breakpointId,
          eventName: event,
          targetName: INSTRUMENTATION_TARGET,
          enabled: true,
          hitCount: 0,
          createdAt: Date.now(),
        });
        breakpointIds.push(breakpointId);
      } catch (error) {
        logger.warn(
          `Failed to set timer instrumentation breakpoint: ${event}`,
          error,
        );
      }
    }
    logger.info(`Set ${breakpointIds.length} timer event breakpoints`);
    return breakpointIds;
  }

  async setWebSocketEventBreakpoints(): Promise<string[]> {
    return this.setBatchBreakpoints(
      EventBreakpointManager.WEBSOCKET_EVENTS,
      'WebSocket',
      'WebSocket',
    );
  }

  private async setBatchBreakpoints(
    events: readonly string[],
    label: string,
    targetName?: string,
  ): Promise<string[]> {
    const breakpointIds: string[] = [];
    for (const event of events) {
      const id = await this.setEventListenerBreakpoint(event, targetName);
      breakpointIds.push(id);
    }
    logger.info(`Set ${breakpointIds.length} ${label} event breakpoints`);
    return breakpointIds;
  }

  getAllEventBreakpoints(): EventBreakpoint[] {
    return Array.from(this.eventBreakpoints.values());
  }

  getEventBreakpoint(breakpointId: string): EventBreakpoint | undefined {
    return this.eventBreakpoints.get(breakpointId);
  }

  incrementHitCount(breakpointId: string): void {
    const bp = this.eventBreakpoints.get(breakpointId);
    if (bp) {
      bp.hitCount++;
    }
  }

  async clearAllEventBreakpoints(): Promise<void> {
    const breakpoints = Array.from(this.eventBreakpoints.values());

    for (const bp of breakpoints) {
      try {
        await this.sendRemoveBreakpoint(bp);
      } catch (error) {
        logger.warn(`Failed to remove event breakpoint ${bp.id}:`, error);
      }
    }

    this.eventBreakpoints.clear();
    logger.info('All event breakpoints cleared');
  }

  async close(): Promise<void> {
    try {
      await this.clearAllEventBreakpoints();
      logger.info('EventBreakpointManager closed');
    } catch (error) {
      logger.error('Failed to close EventBreakpointManager:', error);
      throw error;
    }
  }
}
