/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {createRequire} from 'node:module';

import {logger} from '../logger.js';

// 动态导入 chrome-devtools-frontend 运行时模块，避免将其源码类型拉入当前 TS program。
const require = createRequire(import.meta.url);
const CDTP_MODULE_PATH =
  '../../node_modules/chrome-devtools-frontend/mcp/mcp.js';
let cdtp: any;
let initialized = false;

async function getCdtp(): Promise<any> {
  if (!initialized) {
    cdtp = require(CDTP_MODULE_PATH);
    initialized = true;
  }
  return cdtp;
}

// 从动态导入中获取运行时对象 - 延迟初始化
let _engine: any = null;

async function getEngine(): Promise<any> {
  if (!_engine) {
    const {TraceEngine} = await getCdtp();
    _engine = TraceEngine.TraceModel.Model.createWithAllHandlers();
  }
  return _engine;
}

export interface TraceResult {
  parsedTrace: any;
  insights: any | null;
}

export function traceResultIsSuccess(
  x: TraceResult | TraceParseError,
): x is TraceResult {
  return 'parsedTrace' in x;
}

export interface TraceParseError {
  error: string;
}

export async function parseRawTraceBuffer(
  buffer: Uint8Array<ArrayBufferLike> | undefined,
): Promise<TraceResult | TraceParseError> {
  const engine = await getEngine();
  if (!engine) {
    return {
      error: 'Failed to initialize trace engine.',
    };
  }
  engine.resetProcessor();
  if (!buffer) {
    return {
      error: 'No buffer was provided.',
    };
  }
  const asString = new TextDecoder().decode(buffer);
  if (!asString) {
    return {
      error: 'Decoding the trace buffer returned an empty string.',
    };
  }
  try {
    const data = JSON.parse(asString) as
      | {
          traceEvents: any[];
        }
      | any[];

    const events = Array.isArray(data) ? data : data.traceEvents;
    await engine.parse(events);
    const parsedTrace = engine.parsedTrace();
    if (!parsedTrace) {
      return {
        error: 'No parsed trace was returned from the trace engine.',
      };
    }

    const insights = parsedTrace?.insights ?? null;

    return {
      parsedTrace,
      insights,
    };
  } catch (e) {
    const errorText = e instanceof Error ? e.message : JSON.stringify(e);
    logger(`Unexpected error parsing trace: ${errorText}`);
    return {
      error: errorText,
    };
  }
}

// 延迟初始化的辅助函数
async function getHelpers() {
  const cdtp = await getCdtp();
  return {
    AgentFocus: cdtp.AgentFocus,
    TraceEngine: cdtp.TraceEngine,
    PerformanceTraceFormatter: cdtp.PerformanceTraceFormatter,
    PerformanceInsightFormatter: cdtp.PerformanceInsightFormatter,
  };
}

const extraFormatDescriptions = `Information on performance traces may contain main thread activity represented as call frames and network requests.

- Call frames: represented as stack traces with timing information
- Network requests: includes URL, timing, and resource details`;

export async function getTraceSummary(result: TraceResult): Promise<string> {
  const {AgentFocus, PerformanceTraceFormatter} = await getHelpers();
  const _focus =
    AgentFocus.Session.fromParsedTrace?.(result.parsedTrace) ??
    result.parsedTrace;
  const formatter = new PerformanceTraceFormatter();
  const summaryText =
    formatter.formatTraceSummary?.() ?? 'Performance trace summary';
  return `## Summary of Performance trace findings:
${summaryText}

## Details on call tree & network request formats:
${extraFormatDescriptions}`;
}

export type InsightName = string;
export type InsightOutput = {output: string} | {error: string};

export async function getInsightOutput(
  result: TraceResult,
  insightSetId: string,
  insightName: InsightName,
): Promise<InsightOutput> {
  if (!result.insights) {
    return {
      error: 'No Performance insights are available for this trace.',
    };
  }

  const insightSet = result.insights.get?.(insightSetId);
  if (!insightSet) {
    return {
      error:
        'No Performance Insights for the given insight set id. Only use ids given in the "Available insight sets" list.',
    };
  }

  const matchingInsight =
    insightName in insightSet.model ? insightSet.model[insightName] : null;
  if (!matchingInsight) {
    return {
      error: `No Insight with the name ${String(insightName)} found. Double check the name you provided is accurate and try again.`,
    };
  }

  const {AgentFocus, PerformanceInsightFormatter} = await getHelpers();
  const focus =
    AgentFocus.Session.fromParsedTrace?.(result.parsedTrace) ??
    result.parsedTrace;
  const formatter = new PerformanceInsightFormatter(focus, matchingInsight);
  return {output: formatter.formatInsight?.() ?? 'Insight output'};
}
