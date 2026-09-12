/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * mitmproxy 风格的流量过滤引擎。
 * 提供分词、递归下降语法解析与流目标快速求值。
 */

export interface FilterableFlow {
  url?: string;
  method?: string;
  statusCode?: number;
  requestHeaders?: Record<string, string> | string | null;
  responseHeaders?: Record<string, string> | string | null;
  headers?: Record<string, string> | string | null;
  requestBody?: string | null;
  responseBody?: string | null;
  contentType?: string | null;
  isStatic?: boolean;
  isWebSocket?: boolean | number;
  clientProcess?: {
    pid: number;
    name: string;
    path?: string;
  };
  initiator?: string | null;
  error?: string | boolean | null;
}

export interface FlowFilterHelpItem {
  code: string;
  name: string;
  syntax: string;
  description: string;
}

export const FLOW_FILTER_HELP: FlowFilterHelpItem[] = [
  {
    code: '~a',
    name: 'Asset',
    syntax: '~a',
    description: '匹配静态资源响应（JS/CSS/图片/字体/WASM）',
  },
  {code: '~all', name: 'All', syntax: '~all', description: '匹配全部流量'},
  {
    code: '~b',
    name: 'Body',
    syntax: '~b regex',
    description: '请求或响应正文匹配正则',
  },
  {
    code: '~bq',
    name: 'Request Body',
    syntax: '~bq regex',
    description: '请求正文匹配正则',
  },
  {
    code: '~bs',
    name: 'Response Body',
    syntax: '~bs regex',
    description: '响应正文匹配正则',
  },
  {
    code: '~c',
    name: 'Status Code',
    syntax: '~c int',
    description: 'HTTP 响应状态码（如 200, 404, 5..）',
  },
  {
    code: '~d',
    name: 'Domain',
    syntax: '~d regex',
    description: '域名 Host 匹配正则',
  },
  {
    code: '~e',
    name: 'Error',
    syntax: '~e',
    description: '匹配错误流量（4xx/5xx 或网络错误）',
  },
  {
    code: '~h',
    name: 'Header',
    syntax: '~h regex',
    description: '请求或响应头匹配（"name: value" 或值）',
  },
  {
    code: '~hq',
    name: 'Request Header',
    syntax: '~hq regex',
    description: '请求头匹配',
  },
  {
    code: '~hs',
    name: 'Response Header',
    syntax: '~hs regex',
    description: '响应头匹配',
  },
  {
    code: '~http',
    name: 'HTTP',
    syntax: '~http',
    description: '匹配 HTTP 流量（非 WebSocket）',
  },
  {
    code: '~m',
    name: 'Method',
    syntax: '~m regex',
    description: 'HTTP 请求方法（如 GET, POST）',
  },
  {
    code: '~p',
    name: 'Process',
    syntax: '~p regex',
    description: '本地进程名称或 PID（扩展）',
  },
  {
    code: '~q',
    name: 'Request Only',
    syntax: '~q',
    description: '仅请求（尚无响应或状态码为 0）',
  },
  {
    code: '~s',
    name: 'Response',
    syntax: '~s',
    description: '已有响应的流量',
  },
  {
    code: '~t',
    name: 'Content-Type',
    syntax: '~t regex',
    description: 'Content-Type 快捷匹配',
  },
  {
    code: '~tq',
    name: 'Request Content-Type',
    syntax: '~tq regex',
    description: '请求 Content-Type',
  },
  {
    code: '~ts',
    name: 'Response Content-Type',
    syntax: '~ts regex',
    description: '响应 Content-Type',
  },
  {
    code: '~u',
    name: 'URL',
    syntax: '~u regex',
    description: 'URL 路径及参数正则匹配',
  },
  {
    code: '~websocket',
    name: 'WebSocket',
    syntax: '~websocket',
    description: '匹配 WebSocket 流量',
  },
];

const UNARY_OPERATORS = new Set([
  '~a',
  '~all',
  '~e',
  '~http',
  '~websocket',
  '~q',
  '~s',
]);

const ASSET_CONTENT_TYPES = [
  /text\/javascript/i,
  /application\/x-javascript/i,
  /application\/javascript/i,
  /text\/css/i,
  /image\//i,
  /font\//i,
  /application\/font-/i,
  /application\/x-font-/i,
  /application\/wasm/i,
];

const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|woff2?|ttf|eot|map|wasm)$/i;

function extractHost(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    const m = /\/\/([^/:]+)/.exec(url);
    return m ? m[1] : '';
  }
}

function testRegex(pattern: string, text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function headerValueCaseInsensitive(
  headers: Record<string, string> | null,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function parseHeaders(
  headers?: Record<string, string> | string | null,
): Record<string, string> | null {
  if (!headers) return null;
  if (typeof headers === 'object' && !Array.isArray(headers)) {
    return headers as Record<string, string>;
  }
  if (typeof headers === 'string') {
    try {
      const parsed = JSON.parse(headers);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // 非 JSON
    }
  }
  return null;
}

function getHeaderLines(
  headers?: Record<string, string> | string | null,
): string[] {
  if (!headers) return [];
  const parsed = parseHeaders(headers);
  if (parsed) {
    return Object.entries(parsed).map(([k, v]) => `${k.toLowerCase()}: ${v}`);
  }
  if (typeof headers === 'string') {
    return headers.split('\n');
  }
  return [];
}

function matchHeader(
  pattern: string,
  headers?: Record<string, string> | string | null,
): boolean {
  if (!headers) return false;
  const lines = getHeaderLines(headers);
  return lines.some(line => testRegex(pattern, line));
}

function parseClientProcess(initiator: string | null | undefined): {
  pid?: number;
  name?: string;
} | null {
  if (!initiator) return null;
  try {
    const parsed = JSON.parse(initiator) as {
      type?: string;
      pid?: number;
      name?: string;
    };
    if (parsed && typeof parsed.name === 'string') {
      return {pid: parsed.pid, name: parsed.name};
    }
  } catch {
    // 忽略非 JSON initiator
  }
  return null;
}

function matchProcess(pattern: string, flow: FilterableFlow): boolean {
  if (flow.clientProcess) {
    if (testRegex(pattern, flow.clientProcess.name)) return true;
    if (testRegex(pattern, String(flow.clientProcess.pid))) return true;
  }
  if (flow.initiator) {
    const p = parseClientProcess(flow.initiator);
    if (p) {
      if (p.name && testRegex(pattern, p.name)) return true;
      if (p.pid && testRegex(pattern, String(p.pid))) return true;
    }
    if (testRegex(pattern, flow.initiator)) return true;
  }
  return false;
}

function isAssetFlow(flow: FilterableFlow): boolean {
  if (flow.isStatic === true) return true;
  const ct = flow.contentType;
  if (ct && ASSET_CONTENT_TYPES.some(r => r.test(ct))) {
    return true;
  }
  if (flow.url && STATIC_EXTENSIONS.test(flow.url.split(/[?#]/)[0]!)) {
    return true;
  }
  return false;
}

// ─── 分词与语法解析 ──────────────────────────────────────────

type TokenType =
  | 'OP_UNARY'
  | 'OP_PARAM'
  | 'ARG'
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'LPAREN'
  | 'RPAREN';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const rawTokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      rawTokens.push({type: 'LPAREN', value: '('});
      i++;
      continue;
    }

    if (ch === ')') {
      rawTokens.push({type: 'RPAREN', value: ')'});
      i++;
      continue;
    }

    if (ch === '!') {
      rawTokens.push({type: 'NOT', value: '!'});
      i++;
      continue;
    }

    if (ch === '&') {
      rawTokens.push({type: 'AND', value: '&'});
      i++;
      continue;
    }

    if (ch === '|') {
      rawTokens.push({type: 'OR', value: '|'});
      i++;
      continue;
    }

    if (ch === '~') {
      let op = '~';
      i++;
      while (i < len && /[a-zA-Z0-9_-]/.test(input[i])) {
        op += input[i];
        i++;
      }
      const lower = op.toLowerCase();
      if (UNARY_OPERATORS.has(lower)) {
        rawTokens.push({type: 'OP_UNARY', value: lower});
      } else {
        rawTokens.push({type: 'OP_PARAM', value: lower});
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let val = '';
      while (i < len) {
        if (input[i] === '\\' && i + 1 < len) {
          val += input[i + 1];
          i += 2;
        } else if (input[i] === quote) {
          i++;
          break;
        } else {
          val += input[i];
          i++;
        }
      }
      rawTokens.push({type: 'ARG', value: val});
      continue;
    }

    // 裸字串 / 正则表达式
    let val = '';
    while (i < len && !/[\s()&|!~]/.test(input[i])) {
      val += input[i];
      i++;
    }
    if (val.length > 0) {
      rawTokens.push({type: 'ARG', value: val});
    }
  }

  // 插入隐式 AND：在表达式结束符与下一个表达式开始符之间
  const isExprEnd = (t: Token) =>
    t.type === 'OP_UNARY' || t.type === 'ARG' || t.type === 'RPAREN';
  const isExprStart = (t: Token) =>
    t.type === 'OP_UNARY' ||
    t.type === 'OP_PARAM' ||
    t.type === 'ARG' ||
    t.type === 'NOT' ||
    t.type === 'LPAREN';

  const tokens: Token[] = [];
  for (let idx = 0; idx < rawTokens.length; idx++) {
    const curr = rawTokens[idx];
    tokens.push(curr);
    if (idx + 1 < rawTokens.length) {
      const next = rawTokens[idx + 1];
      if (isExprEnd(curr) && isExprStart(next)) {
        tokens.push({type: 'AND', value: '&'});
      }
    }
  }

  return tokens;
}

type FilterNode =
  | {type: 'and'; children: FilterNode[]}
  | {type: 'or'; children: FilterNode[]}
  | {type: 'not'; child: FilterNode}
  | {type: 'predicate'; op: string; arg?: string}
  | {type: 'const'; value: boolean};

function parseTokens(tokens: Token[]): FilterNode {
  let pos = 0;

  function parseOr(): FilterNode {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos].type === 'OR') {
      pos++;
      const right = parseAnd();
      left = {type: 'or', children: [left, right]};
    }
    return left;
  }

  function parseAnd(): FilterNode {
    let left = parseNot();
    while (pos < tokens.length && tokens[pos].type === 'AND') {
      pos++;
      const right = parseNot();
      left = {type: 'and', children: [left, right]};
    }
    return left;
  }

  function parseNot(): FilterNode {
    if (pos < tokens.length && tokens[pos].type === 'NOT') {
      pos++;
      const child = parseNot();
      return {type: 'not', child};
    }
    return parsePrimary();
  }

  function parsePrimary(): FilterNode {
    if (pos >= tokens.length) {
      return {type: 'const', value: true};
    }
    const tok = tokens[pos++];
    if (tok.type === 'LPAREN') {
      const expr = parseOr();
      if (pos < tokens.length && tokens[pos].type === 'RPAREN') {
        pos++;
      }
      return expr;
    }
    if (tok.type === 'OP_UNARY') {
      return {type: 'predicate', op: tok.value};
    }
    if (tok.type === 'OP_PARAM') {
      let arg = '';
      if (pos < tokens.length && tokens[pos].type === 'ARG') {
        arg = tokens[pos++].value;
      }
      return {type: 'predicate', op: tok.value, arg};
    }
    if (tok.type === 'ARG') {
      // 裸字符串默认作为 URL 匹配 (~u)
      return {type: 'predicate', op: '~u', arg: tok.value};
    }
    return {type: 'const', value: true};
  }

  return parseOr();
}

function evaluatePredicate(
  op: string,
  arg: string | undefined,
  flow: FilterableFlow,
): boolean {
  const param = arg ?? '';

  switch (op) {
    case '~a':
      return isAssetFlow(flow);

    case '~all':
      return true;

    case '~e':
      return Boolean(
        flow.error || (flow.statusCode !== undefined && flow.statusCode >= 400),
      );

    case '~http':
      return !flow.isWebSocket;

    case '~websocket':
      return Boolean(flow.isWebSocket);

    case '~q':
      return !flow.statusCode || flow.statusCode === 0;

    case '~s':
      return Boolean(flow.statusCode && flow.statusCode > 0);

    case '~m':
      return testRegex(param, flow.method);

    case '~c': {
      if (!flow.statusCode) return false;
      if (/^\d+$/.test(param)) {
        return flow.statusCode === Number(param);
      }
      return testRegex(param, String(flow.statusCode));
    }

    case '~u':
      return testRegex(param, flow.url);

    case '~d':
      return testRegex(param, extractHost(flow.url));

    case '~b':
      return (
        testRegex(param, flow.requestBody) ||
        testRegex(param, flow.responseBody)
      );

    case '~bq':
      return testRegex(param, flow.requestBody);

    case '~bs':
      return testRegex(param, flow.responseBody);

    case '~t':
      return (
        testRegex(param, flow.contentType) ||
        matchHeader(
          param,
          flow.requestHeaders || flow.responseHeaders || flow.headers,
        )
      );

    case '~tq': {
      const parsed = parseHeaders(flow.requestHeaders);
      return (
        matchHeader(
          `content-type:.*${escapeRegExp(param)}`,
          flow.requestHeaders,
        ) ||
        testRegex(param, headerValueCaseInsensitive(parsed, 'content-type'))
      );
    }

    case '~ts': {
      const parsed = parseHeaders(flow.responseHeaders);
      return (
        testRegex(param, flow.contentType) ||
        matchHeader(
          `content-type:.*${escapeRegExp(param)}`,
          flow.responseHeaders,
        ) ||
        testRegex(param, headerValueCaseInsensitive(parsed, 'content-type'))
      );
    }

    case '~h':
      return (
        matchHeader(param, flow.requestHeaders) ||
        matchHeader(param, flow.responseHeaders) ||
        matchHeader(param, flow.headers)
      );

    case '~hq':
      return matchHeader(param, flow.requestHeaders);

    case '~hs':
      return matchHeader(param, flow.responseHeaders);

    case '~p':
      return matchProcess(param, flow);

    default:
      // 未知操作符视为匹配 URL
      return testRegex(param, flow.url);
  }
}

function evaluateNode(node: FilterNode, flow: FilterableFlow): boolean {
  switch (node.type) {
    case 'const':
      return node.value;
    case 'predicate':
      return evaluatePredicate(node.op, node.arg, flow);
    case 'not':
      return !evaluateNode(node.child, flow);
    case 'and':
      return node.children.every(c => evaluateNode(c, flow));
    case 'or':
      return node.children.some(c => evaluateNode(c, flow));
    default:
      return true;
  }
}

export interface FlowFilterOptions {
  /** 当输入字符串中没有包含 '~' 时，是否回退为全字段模糊搜索（URL/Method/Status/Process）。默认 false。 */
  fallbackFuzzy?: boolean;
}

/**
 * 判断流过滤表达式是否涉及请求体/响应体/请求头等深层数据（需要后端支持或本地全字段支持）。
 */
export function hasDeepFilter(expr: string): boolean {
  return /~(b|bq|bs|h|hq|hs|t|tq|ts)\b/.test(expr);
}

/**
 * 编译 mitmproxy 流过滤表达式为高阶匹配谓词函数。
 */
export function compileFlowFilter(
  expr: string,
  options?: FlowFilterOptions,
): (flow: FilterableFlow) => boolean {
  const trimmed = expr.trim();
  if (!trimmed) {
    return () => true;
  }

  // 若启用 fallbackFuzzy 且不含任何 ~ 语法，走智能全局模糊匹配
  if (options?.fallbackFuzzy && !trimmed.includes('~')) {
    const q = trimmed.toLowerCase();
    return (flow: FilterableFlow) => {
      if (flow.url && flow.url.toLowerCase().includes(q)) return true;
      if (flow.method && flow.method.toLowerCase().includes(q)) return true;
      if (
        flow.statusCode !== undefined &&
        String(flow.statusCode).includes(q)
      ) {
        return true;
      }
      if (
        flow.clientProcess?.name &&
        flow.clientProcess.name.toLowerCase().includes(q)
      ) {
        return true;
      }
      return false;
    };
  }

  try {
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) {
      return () => true;
    }
    const ast = parseTokens(tokens);
    return (flow: FilterableFlow) => evaluateNode(ast, flow);
  } catch {
    // 解析异常降级为匹配全部：调用方约定「空/残缺表达式不过滤」，
    // 报错会让 list_mitm_requests 等程序化调用中断。
    // ponytail: 仅对含 ~ 的表达式打印一次告警，便于排查却避免刷屏。
    if (trimmed.includes('~')) {
      console.warn(
        `[flowFilter] 无法解析过滤表达式，已降级为匹配全部：${trimmed}`,
      );
    }
    return () => true;
  }
}

/**
 * 直接测试一条流是否匹配指定的过滤表达式。
 */
export function matchesFlowFilter(
  flow: FilterableFlow,
  expr: string,
  options?: FlowFilterOptions,
): boolean {
  return compileFlowFilter(expr, options)(flow);
}
