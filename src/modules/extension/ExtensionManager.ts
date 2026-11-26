/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {promises as fs} from 'node:fs';
import path from 'node:path';

import type {Browser, Page} from '../../third_party/index.js';

export interface Extension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  path: string;
}

export interface CDPSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  detach(): Promise<void>;
}

export interface ExtensionManagerOptions {
  getBrowser: () => Browser | null;
  getSelectedPage: () => Page | null;
}

export class ExtensionManager {
  private readonly extensions = new Map<string, Extension>();

  constructor(private readonly options: ExtensionManagerOptions) {}

  private async readManifestInfo(
    extensionDir: string,
  ): Promise<{name: string; version: string}> {
    const manifestPath = path.join(extensionDir, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      return {
        name:
          typeof manifest.name === 'string'
            ? manifest.name
            : path.basename(extensionDir),
        version:
          typeof manifest.version === 'string' ? manifest.version : '1.0',
      };
    } catch {
      return {
        name: path.basename(extensionDir),
        version: '1.0',
      };
    }
  }

  private async createBrowserCDPSession(): Promise<CDPSessionLike | null> {
    const browser = this.options.getBrowser();
    if (!browser) return null;
    if (typeof (browser as any).newBrowserCDPSession === 'function') {
      return (browser as any).newBrowserCDPSession();
    }
    return null;
  }

  async installExtension(extensionPath: string): Promise<string> {
    const resolvedPath = path.resolve(extensionPath);
    const {name, version} = await this.readManifestInfo(resolvedPath);

    let id: string | undefined;
    const session = await this.createBrowserCDPSession();
    if (session) {
      try {
        const res = await session.send('Extensions.loadUnpacked', {
          path: resolvedPath,
        });
        id = res?.id;
      } finally {
        await session.detach().catch(() => {});
      }
    }

    if (!id) {
      id = Buffer.from(resolvedPath).toString('hex').slice(0, 32);
    }

    const extension: Extension = {
      id,
      name,
      version,
      enabled: true,
      path: resolvedPath,
    };
    this.extensions.set(id, extension);
    return id;
  }

  async uninstallExtension(id: string): Promise<void> {
    const session = await this.createBrowserCDPSession();
    if (session) {
      try {
        await session.send('Extensions.uninstall', {id});
      } finally {
        await session.detach().catch(() => {});
      }
    }
    this.extensions.delete(id);
  }

  async listExtensions(): Promise<Map<string, Extension>> {
    const session = await this.createBrowserCDPSession();
    if (session) {
      try {
        const res = await session.send('Extensions.getExtensions');
        if (res && Array.isArray(res.extensions)) {
          for (const ext of res.extensions) {
            const existing = this.extensions.get(ext.id);
            this.extensions.set(ext.id, {
              id: ext.id,
              name: ext.name ?? existing?.name ?? 'Unknown',
              version: ext.version ?? existing?.version ?? '1.0',
              enabled: ext.enabled ?? true,
              path: ext.path ?? existing?.path ?? '',
            });
          }
        }
      } catch {
        // Fallback to local registry
      } finally {
        await session.detach().catch(() => {});
      }
    }
    return new Map(this.extensions);
  }

  async getExtension(id: string): Promise<Extension | undefined> {
    const list = await this.listExtensions();
    return list.get(id);
  }

  private async readManifestActionPopup(
    extensionDir: string,
  ): Promise<string | undefined> {
    if (!extensionDir) return undefined;
    const manifestPath = path.join(extensionDir, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw) as {
        action?: {default_popup?: string};
        browser_action?: {default_popup?: string};
        page_action?: {default_popup?: string};
      };
      const popup =
        manifest.action?.default_popup ??
        manifest.browser_action?.default_popup ??
        manifest.page_action?.default_popup;
      return typeof popup === 'string' && popup.trim().length > 0
        ? popup.trim().replace(/^\.?\//, '')
        : undefined;
    } catch {
      return undefined;
    }
  }

  async triggerExtensionAction(id: string): Promise<void> {
    const extension = await this.getExtension(id);
    if (!extension) {
      throw new Error(`Extension with ID ${id} not found.`);
    }

    const page = this.options.getSelectedPage();
    let targetId: string | undefined;

    if (page && typeof (page.context as any) === 'function') {
      try {
        const pageSession = await page.context().newCDPSession(page);
        try {
          const info = await pageSession.send('Target.getTargetInfo');
          targetId = info?.targetInfo?.targetId;
        } finally {
          await pageSession.detach().catch(() => {});
        }
      } catch {
        // TargetInfo retrieval failed or page not connected via CDP
      }
    }

    const session = await this.createBrowserCDPSession();
    if (session) {
      try {
        // CDP Target.getTargets 默认排除 type="tab" 目标（见 CDP TargetFilter 规范），
        // 必须显式传入 filter 包含 tab，否则 Extensions.triggerAction 拿不到合法的 tab targetId。
        let targetsRes: {targetInfos?: Array<Record<string, unknown>>};
        try {
          targetsRes = await session.send('Target.getTargets', {
            filter: [{type: 'tab', exclude: false}, {}],
          });
        } catch {
          targetsRes = await session.send('Target.getTargets');
        }
        const targetInfos = targetsRes?.targetInfos ?? [];
        const pageUrl =
          page && typeof page.url === 'function' ? page.url() : undefined;
        // Find matching tab target for the selected page
        const tabTarget =
          targetInfos.find(
            (t: any) =>
              t.type === 'tab' && (pageUrl ? t.url === pageUrl : true),
          ) || targetInfos.find((t: any) => t.type === 'tab');

        const effectiveTargetId =
          (tabTarget?.targetId as string | undefined) ?? targetId;

        try {
          await session.send('Extensions.triggerAction', {
            id,
            ...(effectiveTargetId ? {targetId: effectiveTargetId} : {}),
          });
        } catch (triggerErr: any) {
          const errMsg = triggerErr?.message || String(triggerErr);
          const popupPath = await this.readManifestActionPopup(extension.path);
          if (popupPath) {
            const popupUrl = `chrome-extension://${id}/${popupPath}`;
            if (page && typeof page.context === 'function') {
              const ctx = page.context();
              if (ctx && typeof ctx.newPage === 'function') {
                const popupPage = await ctx.newPage();
                await popupPage.goto(popupUrl, {
                  waitUntil: 'domcontentloaded',
                });
                return;
              }
            }
            await session.send('Target.createTarget', {url: popupUrl});
            return;
          }
          if (/wasn't found|not found|unknown command/i.test(errMsg)) {
            throw new Error(
              `Connected Chromium does not expose CDP Extensions.triggerAction (${errMsg}). ` +
                `Upgrade to Chrome 145+ with --enable-unsafe-extension-debugging, or declare action.default_popup in manifest.json for popup fallback.`,
            );
          }
          const summary = targetInfos.map((t: any) => ({
            id: t.targetId,
            type: t.type,
            url: t.url,
          }));
          throw new Error(`${errMsg}. Targets: ${JSON.stringify(summary)}`);
        }
      } finally {
        await session.detach().catch(() => {});
      }
    }
  }
}
