/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {ReactNode} from 'react';

/** 输入框共享 className（尺寸 + 配色 + 边框） */
export const inputClass =
  'bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]';

/** 字段标签共享 className */
export const labelClass = 'text-xs text-[var(--color-text-secondary)]';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

/**
 * 字段包装器：标签 + 可选说明 + 控件。
 * 只管布局，不含任何输入控件 —— 控件用原生 input/select，避免引入表单库。
 */
export function Field({label, hint, children}: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && (
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}
