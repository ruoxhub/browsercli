/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 改写规则引擎。纯函数式核心：谓词匹配 + 规则应用。不可变，便于不启 server 单测。
 * list_mitm_requests 的结构化过滤与规则匹配共用 matchesPredicate，避免重复。
 */
import {readFileSync} from 'node:fs';

import {matchesFlowFilter} from './flowFilter.js';
import type {
  AfterResponseResult,
  BeforeRequestResult,
  MitmInterceptor,
  MitmRewriteRule,
  RequestContext,
  RequestPredicate,
  ResponseContext,
} from './types.js';

/** 匹配谓词所需的统一视图。body 字段由调用方按 phase 填充。 */
export interface RequestPredicateView {
  method: string;
  url: string;
  headers: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  statusCode: number;
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const m = /\/\/([^/:]+)/.exec(url);
    return m ? m[1] : '';
  }
}

function headerValueCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * 离散谓词匹配（AND 组合，全空 = 命中所有）。
 * - method：大写精确
 * - statusCode：精确（仅 list 过滤用；规则侧 view 传 0 即忽略）
 * - host：hostname 子串（大小写不敏感）
 * - urlFilter：URL 子串（大小写不敏感）
 * - urlRegex：URL 正则（非法正则视为不命中）
 * - headerContains：name 相等（大小写不敏感）且值包含 value
 * - bodyContains：requestBody / responseBody 任一包含（大小写不敏感）
 */
export function matchesPredicate(
  p: RequestPredicate,
  view: RequestPredicateView,
): boolean {
  if (p.filter && !matchesFlowFilter(view, p.filter)) {
    return false;
  }
  if (p.method && view.method.toUpperCase() !== p.method.toUpperCase()) {
    return false;
  }
  if (p.statusCode !== undefined && view.statusCode !== p.statusCode) {
    return false;
  }
  if (p.host) {
    const needle = p.host.toLowerCase();
    if (!extractHost(view.url).toLowerCase().includes(needle)) return false;
  }
  if (p.urlFilter) {
    if (!view.url.toLowerCase().includes(p.urlFilter.toLowerCase())) {
      return false;
    }
  }
  if (p.urlRegex) {
    try {
      if (!new RegExp(p.urlRegex).test(view.url)) return false;
    } catch {
      return false;
    }
  }
  if (p.headerContains) {
    const value = headerValueCaseInsensitive(
      view.headers,
      p.headerContains.name,
    );
    if (value === undefined || !value.includes(p.headerContains.value)) {
      return false;
    }
  }
  if (p.bodyContains) {
    const needle = p.bodyContains.toLowerCase();
    const hit =
      (view.requestBody ?? '').toLowerCase().includes(needle) ||
      (view.responseBody ?? '').toLowerCase().includes(needle);
    if (!hit) return false;
  }
  return true;
}

function deleteKeyCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

/**
 * 应用 header 增量（set / remove），返回新对象。不可变。
 * 供规则引擎内部与 MitmProxyServer 转发侧共用。
 */
export function applyHeaderChanges(
  headers: Record<string, string>,
  opts: {set?: Record<string, string>; remove?: string[]},
): Record<string, string> {
  const out: Record<string, string> = {...headers};
  for (const name of opts.remove ?? []) {
    deleteKeyCaseInsensitive(out, name);
  }
  for (const [key, value] of Object.entries(opts.set ?? {})) {
    deleteKeyCaseInsensitive(out, key);
    out[key] = value;
  }
  return out;
}

function substitute(
  find: string,
  replace: string,
  text: string,
  regex: boolean,
): string {
  if (regex) {
    try {
      return text.replace(new RegExp(find, 'g'), replace);
    } catch {
      return text;
    }
  }
  return text.split(find).join(replace);
}

/** map_remote：URL 正则替换（支持 $1..$n），无命中返回 null。 */
function rewriteUrl(
  urlRegex: string,
  replacement: string,
  url: string,
): string | null {
  try {
    const re = new RegExp(urlRegex, 'g');
    return re.test(url) ? url.replace(re, replacement) : null;
  } catch {
    return null;
  }
}

/**
 * MitmRuleEngine — 持有改写规则集，实现 MitmInterceptor。
 * 运行中 add/remove 即时生效（MitmProxyServer 通过引用访问同一实例）。
 */
export class MitmRuleEngine implements MitmInterceptor {
  private rules: MitmRewriteRule[] = [];
  private nextId = 1;

  addRule(rule: MitmRewriteRule): MitmRewriteRule {
    const idx = this.rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
    return rule;
  }

  nextRuleId(): string {
    return `rewrite-${this.nextId++}`;
  }

  listRules(): MitmRewriteRule[] {
    return [...this.rules];
  }

  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => r.id !== id);
    return this.rules.length < before;
  }

  clearRules(): number {
    const cleared = this.rules.length;
    this.rules = [];
    return cleared;
  }

  /** 仅 response 侧的 modify_body 需要引擎 buffer 响应体。 */
  hasResponseBodyRules(): boolean {
    return this.rules.some(
      r =>
        r.enabled &&
        r.action.type === 'modify_body' &&
        r.action.phase === 'response',
    );
  }

  beforeRequest(ctx: RequestContext): BeforeRequestResult | void {
    const method = ctx.method;
    const url = ctx.url;
    let headers = {...ctx.headers};
    let body = ctx.body;
    let patchedUrl: string | null = null;
    const appliedRuleIds: string[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (
        !this.ruleMatches(
          rule,
          'request',
          method,
          url,
          ctx.headers,
          ctx.body.toString('utf-8'),
        )
      ) {
        continue;
      }
      const action = rule.action;
      switch (action.type) {
        case 'block':
          // terminal
          return {
            action: 'block',
            statusCode: action.statusCode,
            closeConnection: action.closeConnection,
            body: action.body,
            appliedRuleIds: [rule.id],
          };
        case 'map_local': {
          // terminal：读本地文件短路
          try {
            const content = readFileSync(action.localPath);
            const resHeaders: Record<string, string> = {};
            if (action.contentType)
              resHeaders['content-type'] = action.contentType;
            return {
              action: 'respond',
              statusCode: action.statusCode ?? 200,
              headers: resHeaders,
              body: content,
              appliedRuleIds: [rule.id],
            };
          } catch {
            // 文件不可读：该规则静默不命中，继续匹配后续
            continue;
          }
        }
        case 'map_remote': {
          const rewritten = rewriteUrl(
            action.urlRegex,
            action.replacement,
            url,
          );
          if (rewritten !== null && rewritten !== url) {
            patchedUrl = rewritten;
            appliedRuleIds.push(rule.id);
          }
          continue;
        }
        case 'modify_header': {
          if (action.phase !== 'request') continue;
          const next = applyHeaderChanges(headers, {
            set: action.set,
            remove: action.remove,
          });
          if (next !== headers) {
            headers = next;
            appliedRuleIds.push(rule.id);
          }
          continue;
        }
        case 'modify_body': {
          if (action.phase !== 'request') continue;
          const text = substitute(
            action.find,
            action.replace,
            body.toString('utf-8'),
            action.regex ?? false,
          );
          const newBody = Buffer.from(text, 'utf-8');
          if (!newBody.equals(body)) {
            body = newBody;
            appliedRuleIds.push(rule.id);
          }
          continue;
        }
      }
    }

    if (appliedRuleIds.length === 0) return undefined;
    return {
      action: 'forward',
      modification: {
        ...(patchedUrl !== null && {url: patchedUrl}),
        ...(headers !== ctx.headers && {
          setHeaders: diffHeaders(ctx.headers, headers).set,
          removeHeaders: diffHeaders(ctx.headers, headers).remove,
        }),
        ...(!body.equals(ctx.body) && {body}),
      },
      appliedRuleIds,
    };
  }

  afterResponse(ctx: ResponseContext): AfterResponseResult | void {
    let headers = {...ctx.headers};
    let body = ctx.body;
    const appliedRuleIds: string[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (
        !this.ruleMatches(
          rule,
          'response',
          ctx.method,
          ctx.url,
          ctx.headers,
          ctx.body?.toString('utf-8') ?? '',
        )
      ) {
        continue;
      }
      switch (rule.action.type) {
        case 'modify_header': {
          if (rule.action.phase !== 'response') continue;
          const next = applyHeaderChanges(headers, {
            set: rule.action.set,
            remove: rule.action.remove,
          });
          if (next !== headers) {
            headers = next;
            appliedRuleIds.push(rule.id);
          }
          continue;
        }
        case 'modify_body': {
          if (rule.action.phase !== 'response') continue;
          // 截断时 body 为 null，无法改写（server 侧只走 header 改写）。
          if (body === null) continue;
          const text = substitute(
            rule.action.find,
            rule.action.replace,
            body.toString('utf-8'),
            rule.action.regex ?? false,
          );
          const newBody = Buffer.from(text, 'utf-8');
          if (!newBody.equals(body)) {
            body = newBody;
            appliedRuleIds.push(rule.id);
          }
          continue;
        }
        default:
          continue;
      }
    }

    if (appliedRuleIds.length === 0) return undefined;
    return {
      action: 'forward',
      modification: {
        ...(headers !== ctx.headers && {
          setHeaders: diffHeaders(ctx.headers, headers).set,
          removeHeaders: diffHeaders(ctx.headers, headers).remove,
        }),
        ...(body !== ctx.body && body !== null && {body}),
      },
      appliedRuleIds,
    };
  }

  private ruleMatches(
    rule: MitmRewriteRule,
    phase: 'request' | 'response',
    method: string,
    url: string,
    headers: Record<string, string>,
    bodyText: string,
  ): boolean {
    return matchesPredicate(
      {
        urlFilter: rule.urlFilter,
        method: rule.method,
        host: rule.host,
        headerContains: rule.headerContains,
        bodyContains: rule.bodyContains,
      },
      {
        method,
        url,
        headers,
        requestBody: phase === 'request' ? bodyText : null,
        responseBody: phase === 'response' ? bodyText : null,
        statusCode: 0,
      },
    );
  }
}

/** 计算 old → new 之间的 header 增量（set / remove），供 forward modification 用。 */
function diffHeaders(
  oldHeaders: Record<string, string>,
  newHeaders: Record<string, string>,
): {set: Record<string, string>; remove: string[]} {
  const set: Record<string, string> = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(newHeaders)) {
    if (oldHeaders[key] !== value) set[key] = value;
  }
  const lowerNew = new Set(Object.keys(newHeaders).map(k => k.toLowerCase()));
  for (const key of Object.keys(oldHeaders)) {
    if (!lowerNew.has(key.toLowerCase())) remove.push(key);
  }
  return {set, remove};
}
