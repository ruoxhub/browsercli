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
        const targetsRes = await session.send('Target.getTargets');
        const targetInfos = targetsRes?.targetInfos ?? [];
        const pageUrl =
          page && typeof page.url === 'function' ? page.url() : undefined;
        // Find tab target
        const tabTarget =
          targetInfos.find(
            (t: any) =>
              t.type === 'tab' && (pageUrl ? t.url === pageUrl : true),
          ) || targetInfos.find((t: any) => t.type === 'tab');

        const effectiveTargetId = tabTarget?.targetId ?? targetId;

        await session.send('Extensions.triggerAction', {
          id,
          ...(effectiveTargetId ? {targetId: effectiveTargetId} : {}),
        });
      } catch (err: any) {
        const targetsRes = await session
          .send('Target.getTargets')
          .catch(() => ({}));
        const summary = (targetsRes?.targetInfos ?? []).map((t: any) => ({
          id: t.targetId,
          type: t.type,
          url: t.url,
        }));
        throw new Error(
          `${err?.message || err}. Targets: ${JSON.stringify(summary)}`,
        );
      } finally {
        await session.detach().catch(() => {});
      }
    }
  }
}
