/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AXNode {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuemin?: number;
  valuemax?: number;
  valuetext?: string;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  children?: AXNode[];
}

export interface SnapshotNode extends AXNode {
  id: string;
  children?: SnapshotNode[];
}

export interface TextSnapshotResult {
  snapshotId: string;
  root: SnapshotNode;
  idToNode: Map<string, SnapshotNode>;
  formattedText: string;
  nodeCount: number;
}

export interface SnapshotOptions {
  /**
   * 仅包含具有用户交互或可访问性价值的有趣节点。默认 true。
   */
  interestingOnly?: boolean;
  /**
   * 详细模式，包含更多底层节点属性。默认 false。
   */
  verbose?: boolean;
  /**
   * 最大遍历深度，避免深层 DOM 溢出。默认 30。
   */
  maxDepth?: number;
}
