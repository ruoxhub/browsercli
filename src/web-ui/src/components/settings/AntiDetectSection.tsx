/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Shield} from 'lucide-react';

import type {BrowserConfig} from '../../lib/protocol';

import {Field, inputClass} from './Field';

interface AntiDetectSectionProps {
  browser: BrowserConfig | undefined;
  saving: boolean;
  patchBrowser: (patch: Partial<BrowserConfig>) => void;
  onSave: () => void;
}

interface ToggleSpec {
  key:
    | 'cloak'
    | 'jsStealth'
    | 'fullStealthArgs'
    | 'minimalStealth'
    | 'useStealthScripts';
  label: string;
  /** 该项的检测面代价说明，tooltip 展示 */
  cost: string;
}

const TOGGLES: ToggleSpec[] = [
  {
    key: 'cloak',
    label: 'Cloak 二进制',
    cost: '启用 CloakBrowser 二进制 + 49 个 C++ 源码层指纹 patch，profile 目录切到 cloak-profile。默认关闭。',
  },
  {
    key: 'jsStealth',
    label: 'JS 反检测脚本',
    cost: '注入 StealthScripts2025，覆盖 navigator / canvas / WebGL / audio。Object.defineProperty 本身即是检测信号，默认关闭。',
  },
  {
    key: 'fullStealthArgs',
    label: '完整启动参数集',
    cost: '使用历史 60+ 启动参数集，其中多个 flag 本身已是反爬检测信号（--window-size、--disable-blink-features 等）。默认关闭。',
  },
  {
    key: 'minimalStealth',
    label: '最小启动参数集',
    cost: '仅 --test-type + --hide-crash-restore-bubble。默认开启。',
  },
  {
    key: 'useStealthScripts',
    label: 'Stealth 脚本（旧名）',
    cost: 'jsStealth 的旧别名，两者任一为 true 即注入。默认关闭。',
  },
];

export function AntiDetectSection({
  browser,
  saving,
  patchBrowser,
  onSave,
}: AntiDetectSectionProps) {
  const viewport = browser?.viewport;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          反检测
        </h2>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        以下开关全部保持各自默认值，本页只暴露不修改默认语义。开启任一项都会扩大
        检测面，请确认目标站点需要后再启用。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TOGGLES.map(spec => (
          <label
            key={spec.key}
            title={spec.cost}
            className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={browser?.[spec.key] ?? false}
              onChange={e => patchBrowser({[spec.key]: e.target.checked})}
              className="accent-[var(--color-accent)] mt-0.5"
            />
            <span className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-secondary)]">
                {spec.label}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                {spec.cost}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-t border-[var(--color-border-muted)] pt-4 space-y-4">
        <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
          浏览器指纹
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="User Agent">
            <input
              type="text"
              value={browser?.userAgent ?? ''}
              onChange={e => patchBrowser({userAgent: e.target.value})}
              placeholder="留空使用浏览器默认 UA"
              className={`${inputClass} font-mono`}
            />
          </Field>

          <Field
            label="Viewport（宽 × 高）"
            hint="两个都填才会提交；留空表示不修改（本页不支持清空已存值）"
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={viewport?.width ?? ''}
                onChange={e => {
                  const width = Number(e.target.value);
                  const height = viewport?.height;
                  // 两个数字框任一为空 → 不提交（见下方「清空字段」说明）
                  if (!e.target.value || !height) return;
                  patchBrowser({viewport: {width, height}});
                }}
                placeholder="宽"
                className={`${inputClass} font-mono flex-1`}
              />
              <span className="text-xs text-[var(--color-text-muted)]">×</span>
              <input
                type="number"
                min={1}
                value={viewport?.height ?? ''}
                onChange={e => {
                  const height = Number(e.target.value);
                  const width = viewport?.width;
                  if (!e.target.value || !width) return;
                  patchBrowser({viewport: {width, height}});
                }}
                placeholder="高"
                className={`${inputClass} font-mono flex-1`}
              />
            </div>
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存本区配置'}
        </button>
      </div>
    </div>
  );
}
