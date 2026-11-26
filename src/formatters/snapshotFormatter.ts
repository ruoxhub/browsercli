/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Snapshot 格式化器（ADR-0010）：
 * 统一将 TextSnapshotResult 规约为结构化元数据与摘要文本，
 * 供 DeclarativeResponse.materialize() 与快照工具共用。
 */

import type {TextSnapshotResult} from '../modules/snapshot/types.js';

export interface FormattedSnapshotInline {
  snapshotId: string;
  nodeCount: number;
  textOutline: string;
}

export interface FormattedSnapshotFile {
  snapshotId: string;
  nodeCount: number;
  filePath: string;
}

export type FormattedSnapshotPayload =
  | FormattedSnapshotInline
  | FormattedSnapshotFile;

export function formatSnapshotInline(
  snapshot: TextSnapshotResult,
): {payload: FormattedSnapshotInline; line: string} {
  return {
    payload: {
      snapshotId: snapshot.snapshotId,
      nodeCount: snapshot.nodeCount,
      textOutline: snapshot.formattedText,
    },
    line: `Snapshot ${snapshot.snapshotId} captured (${snapshot.nodeCount} nodes)`,
  };
}

export function formatSnapshotSavedFile(
  snapshot: TextSnapshotResult,
  filePath: string,
): {payload: FormattedSnapshotFile; line: string} {
  return {
    payload: {
      snapshotId: snapshot.snapshotId,
      nodeCount: snapshot.nodeCount,
      filePath,
    },
    line: `Snapshot ${snapshot.snapshotId} (${snapshot.nodeCount} nodes) saved to ${filePath}`,
  };
}
