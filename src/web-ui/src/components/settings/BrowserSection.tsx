/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Globe, Plug, PlugZap, Save} from 'lucide-react';

import type {BrowserConfig} from '../../lib/protocol';

import {Field, inputClass} from './Field';

interface BrowserSectionProps {
  browser: BrowserConfig | undefined;
  connected: boolean;
  saving: boolean;
  busy: boolean;
  patchBrowser: (patch: Partial<BrowserConfig>) => void;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function BrowserSection({
  browser,
  connected,
  saving,
  busy,
  patchBrowser,
  onSave,
  onConnect,
  onDisconnect,
}: BrowserSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe
            className={
              connected
                ? 'text-[var(--color-status-green)]'
                : 'text-[var(--color-text-muted)]'
            }
            size={20}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            浏览器连接
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
            connected
              ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
              : 'bg-zinc-500/10 text-[var(--color-text-muted)] border-zinc-500/20'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-status-green)]' : 'bg-[var(--color-text-muted)]'}`}
          />
          {connected ? '已连接' : '未连接'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Headless">
          <select
            value={browser?.headless ? 'true' : 'false'}
            onChange={e => patchBrowser({headless: e.target.value === 'true'})}
            className={inputClass}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </Field>

        <Field label="Channel">
          <select
            value={browser?.channel ?? ''}
            onChange={e => {
              // 空选项 = 不提交该字段（保留服务端现值），不做清空。
              // 不要写 {channel: undefined} —— 详见 viewport 处的说明。
              if (!e.target.value) return;
              patchBrowser({channel: e.target.value});
            }}
            className={inputClass}
          >
            <option value="">默认（内置浏览器）</option>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
            <option value="dev">dev</option>
            <option value="canary">canary</option>
            <option value="chromium">chromium</option>
            <option value="bidi-chromium">bidi-chromium</option>
            <option value="bidi-chrome">bidi-chrome</option>
            <option value="bidi-chrome-beta">bidi-chrome-beta</option>
            <option value="bidi-chrome-dev">bidi-chrome-dev</option>
            <option value="bidi-chrome-canary">bidi-chrome-canary</option>
            <option value="firefox">firefox</option>
            <option value="moz-firefox">moz-firefox</option>
          </select>
        </Field>

        <Field
          label="Browser URL"
          hint="已运行的浏览器 CDP 地址，保存后下次启动会自动连接"
        >
          <input
            type="text"
            value={browser?.browserURL ?? ''}
            onChange={e => patchBrowser({browserURL: e.target.value})}
            placeholder="http://127.0.0.1:9222"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="WS Endpoint">
          <input
            type="text"
            value={browser?.wsEndpoint ?? ''}
            onChange={e => patchBrowser({wsEndpoint: e.target.value})}
            placeholder="ws://127.0.0.1:9222/devtools/browser/..."
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="Executable Path">
          <input
            type="text"
            value={browser?.executablePath ?? ''}
            onChange={e => patchBrowser({executablePath: e.target.value})}
            placeholder="/path/to/chrome"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={browser?.isolated ?? true}
            onChange={e => patchBrowser({isolated: e.target.checked})}
            className="accent-[var(--color-accent)]"
          />
          <span className="text-xs text-[var(--color-text-secondary)]">
            Isolated Context
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={12} />
          {saving ? '保存中...' : '保存本区配置'}
        </button>
        {connected ? (
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--color-status-red)] hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <PlugZap size={12} />
            {busy ? '断开中...' : '断开连接'}
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Plug size={12} />
            {busy ? '连接中...' : '连接浏览器'}
          </button>
        )}
      </div>
    </div>
  );
}
