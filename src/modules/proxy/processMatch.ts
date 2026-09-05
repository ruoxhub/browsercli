/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 进程名匹配（spec §3.3）：不区分大小写的可执行文件 basename 精确匹配；
 * target 无扩展名时自动补 .exe（wechat → wechat.exe）。
 */
const EXE_SUFFIX = '.exe';

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i === -1 ? p : p.slice(i + 1);
}

export function matchesProcessName(target: string, name: string): boolean {
  let t = basename(target.trim()).toLowerCase();
  const n = basename(name.trim()).toLowerCase();
  if (!t || !n) return false;
  if (!t.endsWith(EXE_SUFFIX) && !n.endsWith(EXE_SUFFIX)) {
    // 两侧都无扩展名：直接比
  } else if (!t.endsWith(EXE_SUFFIX)) {
    t += EXE_SUFFIX;
  }
  return (
    t === n || t === n.replace(/\.exe$/, '') || t.replace(/\.exe$/, '') === n
  );
}
