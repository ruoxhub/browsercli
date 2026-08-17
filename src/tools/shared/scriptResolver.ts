/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ScriptResolver — 工具侧的脚本定位解析器
 *
 * 统一解析脚本定位信息（scriptId 或 locator），供 get_script_source /
 * analyze_jsvmp_vm 等工具复用，避免各工具重复实现匹配规则。
 *
 * 匹配优先级（见 spec §3.3）：
 * 1. scriptId 快速路径：当前调试会话内直接命中。
 * 2. locator 重解析：url / sourceLength / domIndex 过滤候选，contentHash
 *    对候选源码现算 SHA-256 后精确过滤。
 *
 * 注意：ScriptInfo.hash 是 CDP 内部 hash，绝不写入 contentHash / sha256；
 * 这里一律对实际 source 字符串（UTF-8）现算 SHA-256。
 */

import crypto from 'node:crypto';

import type {PageSelector} from '../../modules/browser/PageIdentity.js';
import type {ScriptInfo} from '../../modules/debugger/ScriptManager.js';
import {ErrorCodes, ToolError} from '../../utils/errors.js';

export interface ScriptLocator {
  /** 关联的稳定页面 ID。仅用于存在性校验，不用于缩小候选集（见 resolveScript 过滤段注释）。 */
  pageId?: string;
  url?: string;
  domIndex?: number;
  contentHash?: string;
  /** 源码预期字节大小（UTF-8 字节长度，非字符数）。 */
  sourceLength?: number;
}

export interface ScriptLookupParams {
  scriptId?: string;
  locator?: ScriptLocator;
}

export interface ResolvedScript {
  scriptId: string;
  url: string;
  source: string;
  /** 源码字节大小（UTF-8 字节长度，与 sha256 的计算单位一致）。 */
  sourceLength: number;
  sha256: string;
  matchedBy: 'scriptId' | 'hash' | 'domIndex' | 'url';
  staleScriptIdRecovered?: boolean;
}

/** 解析器需要的最小 context：DebuggerManager 的脚本访问 + 页面解析。 */
export interface ScriptResolverContext {
  getScripts(): ScriptInfo[];
  getScriptSource(scriptId: string): Promise<string>;
  resolvePage?(selector: PageSelector): unknown;
}

function sha256(source: string): string {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function toResolvedScript(
  script: ScriptInfo,
  source: string,
  matchedBy: ResolvedScript['matchedBy'],
  staleScriptIdRecovered = false,
): ResolvedScript {
  const result: ResolvedScript = {
    scriptId: script.scriptId,
    url: script.url,
    source,
    sourceLength: Buffer.byteLength(source, 'utf8'),
    sha256: sha256(source),
    matchedBy,
  };
  if (staleScriptIdRecovered) {
    result.staleScriptIdRecovered = true;
  }
  return result;
}

export async function resolveScript(
  context: ScriptResolverContext,
  params: ScriptLookupParams,
): Promise<ResolvedScript> {
  const {scriptId, locator} = params;

  // 1. scriptId 快速路径：当前会话内直接命中。
  if (scriptId !== undefined) {
    const script = context
      .getScripts()
      .find(candidate => candidate.scriptId === scriptId);
    if (script) {
      const source = await context.getScriptSource(scriptId);
      return toResolvedScript(script, source, 'scriptId');
    }
  }

  // 2. scriptId 无效时要求存在 locator。
  if (!locator) {
    if (scriptId !== undefined) {
      throw new ToolError(
        ErrorCodes.SCRIPT_ID_STALE,
        `scriptId '${scriptId}' 在当前调试会话中已失效（页面刷新后 CDP scriptId 会重新分配）`,
        {
          suggestion:
            '请提供 locator 参数，或调用 list_scripts 重新获取当前 scriptId',
          scriptId,
        },
      );
    }
    throw new ToolError(
      ErrorCodes.VALIDATION,
      '必须提供 scriptId 或 locator 参数之一',
    );
  }

  // 3. 先校验 pageId（locator 指向已关闭页面时快速失败）。
  // 注意：pageId 仅做存在性校验，不用于缩小候选集 —— ScriptInfo 无页面归属字段，
  // getScripts() 聚合所有页面；多页同 URL 场景请用 contentHash 或 domIndex 消歧。
  if (locator.pageId !== undefined) {
    try {
      context.resolvePage?.({pageId: locator.pageId});
    } catch {
      throw new ToolError(
        ErrorCodes.PAGE_NOT_FOUND,
        `目标页面 ${locator.pageId} 已关闭或不存在`,
        {
          suggestion: '请调用 list_pages 重新确认当前可用的活跃页面',
          pageId: locator.pageId,
        },
      );
    }
  }

  let candidates = context.getScripts();

  if (locator.url !== undefined) {
    candidates = candidates.filter(script => script.url === locator.url);
  }

  if (locator.sourceLength !== undefined) {
    const matched: ScriptInfo[] = [];
    for (const script of candidates) {
      const source = await context.getScriptSource(script.scriptId);
      if (Buffer.byteLength(source, 'utf8') === locator.sourceLength) {
        matched.push(script);
      }
    }
    candidates = matched;
  }

  if (locator.domIndex !== undefined) {
    const index = locator.domIndex;
    const picked =
      index >= 0 && index < candidates.length ? candidates[index] : undefined;
    candidates = picked ? [picked] : [];
  }

  if (locator.contentHash !== undefined) {
    const matched: ScriptInfo[] = [];
    for (const script of candidates) {
      const source = await context.getScriptSource(script.scriptId);
      if (sha256(source) === locator.contentHash) {
        matched.push(script);
      }
    }
    candidates = matched;
  }

  // 4. 候选冲突判定。
  if (candidates.length === 0) {
    throw new ToolError(
      ErrorCodes.SCRIPT_NOT_FOUND,
      '未在页面中找到符合 locator 条件的脚本',
      {
        suggestion:
          '请确认页面加载已完成（domcontentloaded），或放宽 locator 匹配条件',
      },
    );
  }

  if (candidates.length > 1) {
    const ids = candidates.map(script => script.scriptId);
    throw new ToolError(
      ErrorCodes.SCRIPT_LOCATOR_AMBIGUOUS,
      `定位器匹配到 ${candidates.length} 个候选脚本: ID [${ids.join(', ')}]`,
      {
        suggestion: '请补充 domIndex 或 contentHash 缩小范围',
        candidates: ids,
      },
    );
  }

  const target = candidates[0]!;
  const source = await context.getScriptSource(target.scriptId);

  const matchedBy: ResolvedScript['matchedBy'] =
    locator.contentHash !== undefined
      ? 'hash'
      : locator.domIndex !== undefined
        ? 'domIndex'
        : 'url';

  return toResolvedScript(target, source, matchedBy, scriptId !== undefined);
}
