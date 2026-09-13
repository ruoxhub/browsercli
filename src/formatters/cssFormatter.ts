/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSS 层叠样式格式化器 — 将 CDP CSS.getMatchedStylesForNode 的原始结构
 * 归约为可读的层叠报告（active/overloaded 状态、分页、文本渲染）。
 *
 * 移植自 chrome-devtools-mcp 的 CssFormatter，但输入是原生 CDP 响应而非
 * DevTools 前端对象模型（见 docs/superpowers/specs/2026-09-12-*）。
 */

export interface RawCssProperty {
  name: string;
  value?: string;
  text?: string | null;
  important?: boolean;
  disabled?: boolean;
}

interface RawRule {
  selectorList: {text: string};
  origin: string;
  style: {
    cssProperties: RawCssProperty[];
    styleSheetId?: string;
    range?: {startLine: number};
  };
}

interface RawMatchEntry {
  rule: RawRule;
}

export interface RawMatchedStyles {
  inlineStyle?: {cssProperties: RawCssProperty[]};
  matchedCSSRules?: RawMatchEntry[];
  pseudoElements?: Array<{pseudoType: string; matches: RawMatchEntry[]}>;
  inherited?: Array<{matchedCSSRules?: RawMatchEntry[]}>;
}

export interface CssPropertyLine {
  name: string;
  value: string;
  status: 'active' | 'overloaded';
  important: boolean;
}

export interface CssRuleReport {
  type: 'inline' | 'matched' | 'inherited' | 'pseudo';
  selector: string;
  origin: string;
  source?: string;
  important?: boolean;
  properties: CssPropertyLine[];
}

export interface CssStylesReport {
  elementSelector: string;
  rules: CssRuleReport[];
  totalRules: number;
  page: {pageSize?: number; pageIdx: number; totalPages: number};
}

/** 去掉 longhand 展开（text 为空的重复条目），保留 authored 声明。 */
function dedupeProperties(props: RawCssProperty[]): CssPropertyLine[] {
  const authored = props.filter(p => p.text);
  const source = authored.length > 0 ? authored : props;
  return source.map(p => ({
    name: p.name,
    value: p.value ?? '',
    status: 'active',
    important: p.important === true,
  }));
}

function markStatuses(rules: CssRuleReport[]): void {
  // 优先级从高到低：inline > matched（CDP 升序返回，靠后的规则胜出）
  // > pseudo > inherited。按此顺序首见者为 active，其余为 overloaded；
  // 直接对 rules 倒序扫会把 inline（固定排在数组最前）误判为最低优先级。
  const byPriority = [
    ...rules.filter(r => r.type === 'inline'),
    ...rules.filter(r => r.type === 'matched').reverse(),
    ...rules.filter(r => r.type === 'pseudo').reverse(),
    ...rules.filter(r => r.type === 'inherited').reverse(),
  ];
  const seen = new Set<string>();
  for (const rule of byPriority) {
    // 规则内部后声明的胜出，倒序扫描使最后一条声明先被认领为 active。
    for (const p of [...rule.properties].reverse()) {
      if (seen.has(p.name)) {
        p.status = 'overloaded';
      } else {
        seen.add(p.name);
      }
    }
  }
}

function ruleToReport(
  entry: RawMatchEntry,
  type: CssRuleReport['type'],
): CssRuleReport {
  const {rule} = entry;
  const properties = dedupeProperties(rule.style.cssProperties);
  return {
    type,
    selector: rule.selectorList.text,
    origin: rule.origin,
    source: rule.style.styleSheetId ? 'stylesheet' : '<style>',
    important: properties.some(p => p.important),
    properties,
  };
}

export function formatMatchedStyles(
  raw: RawMatchedStyles,
  options: {elementSelector: string; pageSize?: number; pageIdx?: number},
): CssStylesReport {
  const rules: CssRuleReport[] = [];

  if (raw.inlineStyle) {
    rules.push({
      type: 'inline',
      selector: 'inline style',
      origin: 'inline',
      source: 'style attribute',
      properties: dedupeProperties(raw.inlineStyle.cssProperties),
    });
  }
  for (const entry of raw.matchedCSSRules ?? []) {
    rules.push(ruleToReport(entry, 'matched'));
  }
  for (const pseudo of raw.pseudoElements ?? []) {
    for (const match of pseudo.matches ?? []) {
      rules.push(ruleToReport(match, 'pseudo'));
    }
  }
  for (const inh of raw.inherited ?? []) {
    for (const entry of inh.matchedCSSRules ?? []) {
      rules.push(ruleToReport(entry, 'inherited'));
    }
  }

  // active/overloaded 判定：inline 优先，其次按 CDP 的升序 cascade 顺序。
  // 注意 !important 跨规则的完整模拟交由 CDP 的排序保证——本格式化器
  // 只负责标注"哪些声明最终没有生效"。
  markStatuses(rules);

  const totalRules = rules.length;
  const pageSize = options.pageSize;
  const pageIdx = options.pageIdx ?? 0;
  const totalPages = pageSize
    ? Math.max(1, Math.ceil(totalRules / pageSize))
    : 1;

  const paginated = pageSize
    ? rules.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize)
    : rules;

  return {
    elementSelector: options.elementSelector,
    rules: paginated,
    totalRules,
    page: {pageSize, pageIdx, totalPages},
  };
}

export function renderCssStylesReport(report: CssStylesReport): string {
  const lines: string[] = [];
  lines.push(`### CSS styles for \`${report.elementSelector}\``);
  lines.push(
    `(${report.totalRules} rule(s), page ${report.page.pageIdx + 1}/${report.page.totalPages})`,
  );
  for (const rule of report.rules) {
    lines.push('');
    const suffix = rule.origin === 'user-agent' ? ' [user-agent]' : '';
    lines.push(`* ${rule.selector}${suffix}`);
    for (const p of rule.properties) {
      const marker = p.status === 'overloaded' ? '[overloaded] ' : '';
      const bang = p.important ? ' !important' : '';
      lines.push(`  - ${marker}${p.name}: ${p.value}${bang}`);
    }
  }
  return lines.join('\n');
}
