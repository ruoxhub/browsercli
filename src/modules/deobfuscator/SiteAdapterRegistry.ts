import type * as t from '@babel/types';

export interface SitePattern {
  id: string;
  displayName: string;
  hintTokens: string[];
  contentRegexes: RegExp[];
  families: string[];
}

export interface SiteAdapter {
  readonly patternId: string;
  prePasses?: Array<(ast: t.File) => {ast: t.File; changed: boolean}>;
  postPasses?: Array<(ast: t.File) => {ast: t.File; changed: boolean}>;
  skipPasses?: string[];
}

interface DetectionResult {
  id: string;
  score: number;
  reasons: string[];
}

const PATTERNS: SitePattern[] = [
  {
    id: 'generic',
    displayName: 'generic layered pipeline',
    hintTokens: [],
    contentRegexes: [],
    families: ['generic'],
  },
  {
    id: 'reese84',
    displayName: 'reese84',
    hintTokens: ['reese84'],
    contentRegexes: [/reese84/i],
    families: ['vm-heavy', 'dispatcher-heavy'],
  },
  {
    id: 'dingxiang',
    displayName: 'dingxiang',
    hintTokens: ['顶象', 'dingxiang', 'dx'],
    contentRegexes: [/dingxiang/i],
    families: ['param-array', 'dispatcher-heavy'],
  },
  {
    id: 'geetest4',
    displayName: 'geetest4',
    hintTokens: ['极验4', 'geetest4', 'geetest'],
    contentRegexes: [/geetest/i],
    families: ['guarded-switch', 'vm-heavy'],
  },
  {
    id: 'tonghuashun',
    displayName: 'tonghuashun',
    hintTokens: ['同花顺', 'tonghuashun', '10jqka'],
    contentRegexes: [/10jqka/i, /split\(\s*["']\|["']\s*\)/],
    families: ['split-order-source', 'dispatcher-wrapper'],
  },
  {
    id: 'yidun',
    displayName: 'yidun',
    hintTokens: ['网易易盾', 'yidun', '163'],
    contentRegexes: [/yidun/i],
    families: ['dispatcher-heavy'],
  },
  {
    id: 'xiaohongshu',
    displayName: 'xiaohongshu',
    hintTokens: ['小红书', 'xiaohongshu', 'xhs'],
    contentRegexes: [/xiaohongshu/i, /\bxhs\b/i],
    families: ['wrapper-light'],
  },
  {
    id: 'cn-bidding-ob',
    displayName: 'cn-bidding-ob',
    hintTokens: ['中国招标投标公共服务平台', '招标投标', 'ob'],
    contentRegexes: [/\b_0x[a-f0-9]+\b/i],
    families: ['ob-variant'],
  },
  {
    id: 'mps-ob',
    displayName: 'mps-ob',
    hintTokens: ['中华人民共和国公安部', '公安部', 'mps', 'ob'],
    contentRegexes: [/\b_0x[a-f0-9]+\b/i],
    families: ['ob-variant'],
  },
];

function normalizeHint(value: string | undefined): string {
  return String(value || '').toLowerCase();
}

export class SiteAdapterRegistry {
  private adapters = new Map<string, SiteAdapter>();

  register(adapter: SiteAdapter): void {
    this.adapters.set(adapter.patternId, adapter);
  }

  getAdapter(patternId: string): SiteAdapter | undefined {
    return this.adapters.get(patternId);
  }

  detect(
    sourceText: string,
    hint?: string,
    inputPath?: string,
  ): {bestId: string; scores: Map<string, number>; detections: DetectionResult[]} {
    const detections: DetectionResult[] = PATTERNS.filter(p => p.id !== 'generic')
      .map(pattern => {
        let score = 0;
        const reasons: string[] = [];
        const haystacks = [normalizeHint(inputPath), normalizeHint(hint)];

        for (const token of pattern.hintTokens) {
          const normalized = normalizeHint(token);
          if (!normalized) continue;
          if (haystacks.some(v => v.includes(normalized))) {
            score += 10;
            reasons.push(`hint:${token}`);
          }
        }

        for (const regex of pattern.contentRegexes) {
          if (regex.test(sourceText)) {
            score += 3;
            reasons.push(`content:${regex.source}`);
          }
        }

        return {id: pattern.id, score, reasons};
      })
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const bestId = detections.length > 0 ? detections[0]!.id : 'generic';
    const scores = new Map(detections.map(d => [d.id, d.score]));

    return {bestId, scores, detections};
  }

  static getPatterns(): SitePattern[] {
    return PATTERNS;
  }
}
