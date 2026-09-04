/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type SizeCategory = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge';

export interface MessageGroupV2 {
  id: string;
  direction: 'sent' | 'received';
  head4B: string;
  sizeCategory: SizeCategory;
  count: number;
  minSize: number;
  maxSize: number;
  hint: string;
  sampleIndices: number[];
}

export interface TrafficSummary {
  wsid: number;
  url: string;
  durationMs: number;
  totalFrames: number;
  sentCount: number;
  receivedCount: number;
  groups: MessageGroupV2[];
  groupToIndices: Map<string, number[]>;
}

export type WsDecodeMode = 'auto' | 'protobuf' | 'json' | 'raw';
