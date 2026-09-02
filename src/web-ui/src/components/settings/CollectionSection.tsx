/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Gauge} from 'lucide-react';

import type {BrowserConfig} from '../../lib/protocol';

import {Field, inputClass} from './Field';

interface CollectionSectionProps {
  browser: BrowserConfig | undefined;
  saving: boolean;
  patchBrowser: (patch: Partial<BrowserConfig>) => void;
  onSave: () => void;
}

interface NumberSpec {
  key:
    | 'maxCollectedUrls'
    | 'maxFilesPerCollect'
    | 'maxTotalContentSize'
    | 'maxSingleFileSize'
    | 'timeout'
    | 'waitForBrowserTimeoutMs';
  label: string;
  hint: string;
}

const NUMBERS: NumberSpec[] = [
  {
    key: 'maxCollectedUrls',
    label: '最大采集 URL 数',
    hint: '单次采集最多收集的 URL 数量',
  },
  {
    key: 'maxFilesPerCollect',
    label: '单次最大文件数',
    hint: '单次采集最多落盘的文件数量',
  },
  {
    key: 'maxTotalContentSize',
    label: '总内容大小上限（字节）',
    hint: '单次采集的内容总量上限',
  },
  {
    key: 'maxSingleFileSize',
    label: '单文件大小上限（字节）',
    hint: '超过此大小的单个文件不落盘',
  },
  {
    key: 'timeout',
    label: '超时时间（ms）',
    hint: '浏览器操作默认超时',
  },
  {
    key: 'waitForBrowserTimeoutMs',
    label: '等待浏览器超时（ms）',
    hint: '启动后等待浏览器就绪的超时时间',
  },
];

export function CollectionSection({
  browser,
  saving,
  patchBrowser,
  onSave,
}: CollectionSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Gauge
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          采集与限制
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {NUMBERS.map(spec => (
          <Field
            key={spec.key}
            label={spec.label}
            hint={spec.hint}
          >
            <input
              type="number"
              min={spec.key === 'waitForBrowserTimeoutMs' ? 0 : 1}
              value={browser?.[spec.key] ?? ''}
              onChange={e => {
                // 空字符串 = 不提交该字段（保留服务端现值），不做清空。
                // 不要写成 {[spec.key]: undefined} —— JSON.stringify 会丢键，
                // 浅合并后旧值原样保留，界面显示空而实际上仍有值（见 viewport 说明）。
                if (!e.target.value) return;
                patchBrowser({[spec.key]: Number(e.target.value)});
              }}
              placeholder="留空则不修改"
              className={`${inputClass} font-mono`}
            />
          </Field>
        ))}
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
