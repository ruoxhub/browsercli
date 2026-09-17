/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {EventEmitter} from 'node:events';

import type {JsonRpcPeer} from '../protocol/jsonrpc.js';
import type {
  ExtensionCdpDetachParams,
  ExtensionCdpEventParams,
  ExtensionPingResult,
  ExtensionTabInfo,
  ExtensionTabLifecycleParams,
} from '../protocol/types.js';

export class ExtensionSessionManager extends EventEmitter {
  private static instance: ExtensionSessionManager | null = null;
  private peer: JsonRpcPeer | null = null;
  private claimedTabs = new Set<number>();
  private attachedTabs = new Set<number>();

  public static getInstance(): ExtensionSessionManager {
    if (!ExtensionSessionManager.instance) {
      ExtensionSessionManager.instance = new ExtensionSessionManager();
    }
    return ExtensionSessionManager.instance;
  }

  public static resetInstance(): void {
    if (ExtensionSessionManager.instance) {
      ExtensionSessionManager.instance.disconnect();
      ExtensionSessionManager.instance = null;
    }
  }

  setPeer(peer: JsonRpcPeer): void {
    if (this.peer) {
      this.peer.close('Replaced by new peer');
    }
    this.peer = peer;

    // Register notification listeners
    this.peer.onNotification('onCDPEvent', raw => {
      const data = raw as ExtensionCdpEventParams;
      this.emit('cdpEvent', data);
      this.emit(`cdpEvent:${data.tabId}`, data);
    });

    this.peer.onNotification('onCDPDetach', raw => {
      const data = raw as ExtensionCdpDetachParams;
      this.attachedTabs.delete(data.tabId);
      this.emit('cdpDetach', data);
      this.emit(`cdpDetach:${data.tabId}`, data);
    });

    this.peer.onNotification('onTabClosed', raw => {
      const data = raw as {tabId: number};
      this.claimedTabs.delete(data.tabId);
      this.attachedTabs.delete(data.tabId);
      this.emit('tabClosed', data.tabId);
    });

    this.peer.onNotification('onTabUpdated', raw => {
      const data = raw as ExtensionTabLifecycleParams;
      this.emit('tabUpdated', data);
    });

    this.emit('connected');
  }

  isConnected(): boolean {
    return this.peer !== null;
  }

  private requirePeer(): JsonRpcPeer {
    if (!this.peer) {
      throw new Error(
        'Chrome extension is not connected. Please ensure the extension is installed and running.',
      );
    }
    return this.peer;
  }

  async ping(): Promise<ExtensionPingResult> {
    return this.requirePeer().sendRequest<ExtensionPingResult>('ping');
  }

  async listTabs(): Promise<ExtensionTabInfo[]> {
    return this.requirePeer().sendRequest<ExtensionTabInfo[]>('listTabs');
  }

  async claimTab(
    tabId: number,
  ): Promise<{success: boolean; tabId: number; url?: string; title?: string}> {
    const res = await this.requirePeer().sendRequest<{
      success: boolean;
      tabId: number;
      url?: string;
      title?: string;
    }>('claimUserTab', {tabId});
    this.claimedTabs.add(tabId);
    this.attachedTabs.add(tabId);
    return res;
  }

  async createTab(
    url = 'about:blank',
    active = true,
  ): Promise<{success: boolean; tabId: number; url?: string; title?: string}> {
    const res = await this.requirePeer().sendRequest<{
      success: boolean;
      tabId: number;
      url?: string;
      title?: string;
    }>('createTab', {url, active});
    this.claimedTabs.add(res.tabId);
    this.attachedTabs.add(res.tabId);
    return res;
  }

  async closeTab(tabId: number): Promise<{success: boolean; tabId: number}> {
    const res = await this.requirePeer().sendRequest<{
      success: boolean;
      tabId: number;
    }>('closeTab', {tabId});
    this.claimedTabs.delete(tabId);
    this.attachedTabs.delete(tabId);
    return res;
  }

  async focusTab(tabId: number): Promise<{success: boolean; tabId: number}> {
    return this.requirePeer().sendRequest<{
      success: boolean;
      tabId: number;
    }>('focusTab', {tabId});
  }

  async attach(tabId: number): Promise<{success: boolean; tabId: number}> {
    const res = await this.requirePeer().sendRequest<{
      success: boolean;
      tabId: number;
    }>('attach', {tabId});
    this.attachedTabs.add(tabId);
    return res;
  }

  async detach(tabId: number): Promise<{success: boolean; tabId: number}> {
    const res = await this.requirePeer().sendRequest<{
      success: boolean;
      tabId: number;
    }>('detach', {tabId});
    this.attachedTabs.delete(tabId);
    return res;
  }

  async executeCdp<T = Record<string, unknown>>(
    tabId: number,
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    return this.requirePeer().sendRequest<T>('executeCdp', {
      tabId,
      method,
      commandParams: params,
      sessionId,
    });
  }

  async moveMouse(
    tabId: number,
    x: number,
    y: number,
    durationMs = 120,
  ): Promise<{success: boolean; arrived?: boolean}> {
    return this.requirePeer().sendRequest<{
      success: boolean;
      arrived?: boolean;
    }>('moveMouse', {tabId, x, y, durationMs});
  }

  getClaimedTabs(): number[] {
    return Array.from(this.claimedTabs);
  }

  getAttachedTabs(): number[] {
    return Array.from(this.attachedTabs);
  }

  disconnect(): void {
    if (this.peer) {
      this.peer.close('Manager disconnected');
      this.peer = null;
    }
    this.claimedTabs.clear();
    this.attachedTabs.clear();
    this.emit('disconnected');
  }
}
