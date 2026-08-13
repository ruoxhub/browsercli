# CAPTCHA Passive Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended, only after explicit user authorization) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation must run in a fresh context that has not read the AGPL reference implementation.

**Goal:** Add a clean-room, read-only CAPTCHA assessment module and one explicit detect_captcha MCP tool that can detect, explain, and wait for CAPTCHA clearance without solving or mutating the page.

**Architecture:** A pure rules layer converts a bounded page snapshot into a deterministic CaptchaAssessment. CaptchaDetector owns only Patchright page reads, timeout handling, and the wait-for-clear state machine. The page-domain MCP tool is a thin adapter over the current selected page and existing structured-response pipeline.

**Tech Stack:** TypeScript ESM, Patchright Page API, Zod, Node node:test, Sinon fake timers, SWC, c8, existing ToolDefinition/page manifest generator.

## Global Constraints

- Source of truth: docs/superpowers/specs/2026-08-13-captcha-passive-detection-design.md.
- Clean-room: do not open, copy, translate, import, or inspect open-source/jshookmcp source, types, rules, tests, fixtures, or build output during implementation.
- Start in a fresh agent/session and create an isolated git worktree with the using-git-worktrees skill. The worktree must start clean from the commit containing this plan.
- The current root checkout contains unrelated debugger, worker, browsercli, jsvmp, and generated-index edits. Do not copy, stage, revert, or overwrite them.
- No subagent or remote agent dispatch unless the user explicitly grants that authority.
- No automatic solving, clicks, drags, form input, token injection, screenshots, AI calls, network calls, file writes, browser restart, headless-mode switch, init script, eager CDP activation, background listener, or new dependency.
- Keep top-level DOM plus suspicious iframe metadata as the first-version ceiling.
- Use Apache-2.0 license headers matching the target repository.
- Use test-driven-development for every production change: write the named behavior test, observe the expected failure, add only the code needed to pass, then rerun.
- Use karpathy-guidelines while editing: every changed line must trace to this plan.
- Run `npm audit --audit-level=high` before each task commit. Record any pre-existing finding; do not change dependencies because this feature adds none.
- Do not hand-edit build/ or src/tools/generated-tools-index.ts. Run npm run build:index for the tracked generated index.
- Before completion, use close-code-change and verification-before-completion against the final diff, then run agent-self-evaluation.

## Execution Preflight

The fresh executor first announces and uses `using-git-worktrees`. Detect existing isolation, prefer a native worktree mechanism, otherwise use the already ignored `.worktrees/` directory and create branch `feat/captcha-passive-detection`. The executor must not reuse this planning conversation or open the AGPL reference tree.

Then run:

```powershell
git status --short --branch
git log -3 --oneline
Test-Path -LiteralPath 'docs/superpowers/specs/2026-08-13-captcha-passive-detection-design.md'
Test-Path -LiteralPath 'docs/superpowers/plans/2026-08-13-captcha-passive-detection.md'
node --version
npm --version
```

Expected:

- The isolated worktree is on a dedicated feature branch.
- git status has no changes.
- Both approved documents exist.
- Node satisfies `^20.19.0 || ^22.12.0 || >=23`.

If `node_modules` is absent in the isolated worktree, run:

```powershell
npm ci
```

Establish the clean baseline before editing:

```powershell
npm run typecheck
npm run test:unit
npm run check-format
```

Expected: all three baseline gates pass. If a baseline gate fails, preserve its exact output and ask the user whether to investigate or proceed; do not attribute a pre-existing failure to CAPTCHA work.

Do not run a repository-wide formatter. Format only files owned by this plan.

## File Map

Create:

- src/modules/captcha/types.ts — public assessment types plus internal bounded snapshot types.
- src/modules/captcha/rules.ts — pure phrase, DOM, exclusion, ordering, and aggregation logic.
- src/modules/captcha/CaptchaDetector.ts — bounded page snapshot acquisition, five-second assessment deadline, and stable-clear waiting.
- src/modules/captcha/index.ts — stable public exports only.
- src/tools/page/detectCaptcha.ts — read-only MCP adapter.
- tests/unit/modules/captcha/CaptchaRules.test.ts — pure rules and aggregation behavior.
- tests/unit/modules/captcha/CaptchaDetector.test.ts — page sampling, privacy, timeout, and wait state machine.
- tests/unit/tools/page/detectCaptcha.test.ts — schema, handler, response, and registration behavior.

Modify:

- src/tools/page/manifest.ts — add the detectCaptcha entry to the existing page domain.
- src/tools/page/index.ts — export detectCaptcha.
- src/tools/generated-tools-index.ts — generator-owned result of npm run build:index.

Do not modify:

- package.json, package-lock.json, RuntimeServices, BrowserManager, configuration schemas, worker context, build/, or any existing unrelated test.

---

### Task 1: Pure assessment model and deterministic rules

**Files:**

- Create: src/modules/captcha/types.ts
- Create: src/modules/captcha/rules.ts
- Create: tests/unit/modules/captcha/CaptchaRules.test.ts

**Interfaces:**

- Produces: CaptchaStatus, CaptchaKind, CaptchaEvidence, CaptchaAssessment, CaptchaElementSnapshot, CaptchaPageSnapshot.
- Produces: assessCaptchaSnapshot(input: CaptchaAssessmentInput): CaptchaAssessment.
- Consumes: no browser, filesystem, network, AI, or runtime service.

- [ ] **Step 1: Write the failing pure-rules tests**

Create tests/unit/modules/captcha/CaptchaRules.test.ts with this content:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {assessCaptchaSnapshot} from '../../../../src/modules/captcha/rules.js';

import type {
  CaptchaElementSnapshot,
  CaptchaPageSnapshot,
} from '../../../../src/modules/captcha/types.js';

const EMPTY_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [],
};

function element(
  overrides: Partial<CaptchaElementSnapshot>,
): CaptchaElementSnapshot {
  return {
    tagName: 'div',
    id: '',
    className: '',
    role: '',
    ariaLabel: '',
    src: '',
    title: '',
    alt: '',
    visible: true,
    hasSiteKey: false,
    draggable: false,
    ...overrides,
  };
}

function assess(input: {
  url?: string;
  title?: string;
  bodyText?: string;
  elements?: CaptchaElementSnapshot[];
}) {
  return assessCaptchaSnapshot({
    url: input.url ?? 'https://example.test/account',
    title: input.title ?? 'Account',
    snapshot: {
      bodyText: input.bodyText ?? '',
      elements: input.elements ?? [],
    },
  });
}

describe('assessCaptchaSnapshot', () => {
  it('classifies product-neutral strong DOM structures', () => {
    const cases = [
      {
        name: 'widget',
        candidate: element({tagName: 'div', hasSiteKey: true}),
        kind: 'widget',
        selector: '[data-sitekey]',
      },
      {
        name: 'slider',
        candidate: element({
          id: 'human-challenge',
          role: 'slider',
          draggable: true,
        }),
        kind: 'slider',
        selector: 'div[role="slider"]',
      },
      {
        name: 'image',
        candidate: element({
          tagName: 'img',
          className: 'captcha-image',
          alt: 'human challenge image',
        }),
        kind: 'image',
        selector: 'img',
      },
      {
        name: 'browser check',
        candidate: element({
          tagName: 'form',
          className: 'browser-security-check',
        }),
        kind: 'browser_check',
        selector: 'form',
      },
    ] as const;

    for (const sample of cases) {
      const result = assess({elements: [sample.candidate]});
      assert.equal(result.status, 'detected', sample.name);
      assert.equal(result.detected, true, sample.name);
      assert.equal(result.kind, sample.kind, sample.name);
      assert.equal(result.confidence, 95, sample.name);
      assert.equal(result.recommendation, 'manual', sample.name);
      assert.equal(result.evidence[0]?.strength, 'strong', sample.name);
      assert.equal(result.evidence[0]?.selector, sample.selector, sample.name);
    }
  });

  it('keeps one weak source suspected and promotes independent sources', () => {
    const weakCases = [
      {url: 'https://example.test/security-check'},
      {title: 'Human verification required'},
      {bodyText: 'Verify that you are human'},
    ];
    for (const sample of weakCases) {
      const oneSource = assess(sample);
      assert.equal(oneSource.status, 'suspected');
      assert.equal(oneSource.detected, false);
      assert.equal(oneSource.confidence, 50);
      assert.equal(oneSource.recommendation, 'observe');
    }

    const twoSources = assess({
      url: 'https://example.test/security-check',
      title: 'Human verification required',
    });
    assert.equal(twoSources.status, 'detected');
    assert.equal(twoSources.confidence, 85);

    const threeSources = assess({
      url: 'https://example.test/security-check',
      title: 'Human verification required',
      bodyText: 'Drag the slider to prove you are human',
    });
    assert.equal(threeSources.status, 'detected');
    assert.equal(threeSources.confidence, 90);
    assert.equal(threeSources.kind, 'slider');
  });

  it('excludes account codes without overriding strong DOM evidence', () => {
    const exclusionCases = [
      {
        title: 'Email verification code',
        bodyText: 'Enter the one-time code sent to your email',
      },
      {bodyText: 'Use your authenticator code for 2FA'},
      {url: 'https://example.test/verify-email'},
      {bodyText: '输入短信验证码'},
    ];
    for (const sample of exclusionCases) {
      const accountCode = assess(sample);
      assert.equal(accountCode.status, 'not_detected');
      assert.equal(accountCode.kind, 'none');
      assert.equal(accountCode.confidence, 0);
      assert.equal(accountCode.recommendation, 'continue');
      assert.ok(accountCode.exclusions.length >= 1);
    }

    const conflict = assess({
      title: 'Security challenge',
      bodyText: 'Enter verification code',
    });
    assert.equal(conflict.status, 'suspected');
    assert.equal(conflict.confidence, 35);
    assert.equal(conflict.recommendation, 'ask_ai');

    const strongDomWins = assess({
      bodyText: '输入短信验证码',
      elements: [element({tagName: 'iframe', title: 'human challenge'})],
    });
    assert.equal(strongDomWins.status, 'detected');
    assert.equal(strongDomWins.kind, 'widget');
    assert.equal(strongDomWins.confidence, 95);
  });

  it('ignores hidden and generic range controls and returns bounded fixed evidence', () => {
    const secret = 'site-key-value-must-not-escape';
    const result = assess({
      bodyText: '拖动滑块完成验证 ' + secret,
      elements: [
        element({
          tagName: 'div',
          id: 'captcha-slider',
          role: 'slider',
          draggable: true,
          visible: false,
        }),
        element({
          tagName: 'input',
          className: 'volume-range',
          role: 'slider',
        }),
        element({
          tagName: 'iframe',
          title: 'human challenge ' + secret,
        }),
        element({
          tagName: 'iframe',
          title: 'human challenge ' + secret,
        }),
      ],
    });

    assert.equal(result.status, 'detected');
    assert.equal(result.kind, 'widget');
    assert.equal(
      result.evidence.filter(item => item.ruleId === 'dom-human-widget').length,
      1,
    );
    assert.deepEqual(
      result.evidence.map(item => item.source),
      ['dom', 'text'],
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));

    const noChallenge = assess({
      elements: [
        element({tagName: 'input', className: 'volume-range', role: 'slider'}),
        element({className: 'carousel-slider', role: 'slider'}),
        element({className: 'upload-progress', role: 'progressbar'}),
      ],
    });
    assert.equal(noChallenge.status, 'not_detected');

    const genericChallenge = assess({
      elements: [element({id: 'challenge'})],
    });
    assert.equal(genericChallenge.status, 'suspected');
    assert.equal(genericChallenge.kind, 'unknown');

    const bounded = assess({
      url: 'https://example.test/security-check',
      title: 'Human verification required',
      elements: [
        'a',
        'article',
        'aside',
        'button',
        'canvas',
        'dialog',
        'div',
        'fieldset',
        'form',
        'img',
        'input',
        'label',
        'li',
        'main',
        'p',
        'section',
        'span',
        'svg',
        'table',
        'tbody',
        'td',
        'tr',
        'ul',
      ].map(tagName =>
        element({
          tagName,
          id: 'captcha',
        }),
      ),
    });
    assert.equal(bounded.status, 'detected');
    assert.equal(bounded.confidence, 90);
    assert.equal(bounded.evidence.length, 20);
  });

  it('clips public page metadata without decoding the URL', () => {
    const longUrl =
      'https://example.test/%E0%A4%A/security-check?' + 'x'.repeat(3000);
    const longTitle = 'Human verification ' + 'y'.repeat(400);
    const result = assessCaptchaSnapshot({
      url: longUrl,
      title: longTitle,
      snapshot: EMPTY_SNAPSHOT,
    });

    assert.equal(result.page.url.length, 2048);
    assert.equal(result.page.title.length, 256);
    assert.ok(result.page.url.includes('%E0%A4%A'));
  });
});
```

The production mutation each test catches is explicit:

- Removing a structural DOM classifier breaks the first test.
- Promoting one weak source or changing confidence bands breaks the second.
- Removing exclusion precedence breaks the third.
- Returning raw matched text, failing to deduplicate, or accepting a generic range control breaks the fourth.
- Removing public metadata bounds or decoding malformed URL text breaks the fifth.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js
```

Expected: FAIL because src/modules/captcha/rules.js and types.js do not exist. This is the correct missing-feature failure.

- [ ] **Step 3: Add the shared types**

Create src/modules/captcha/types.ts:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export type CaptchaStatus = 'detected' | 'suspected' | 'not_detected';

export type CaptchaKind =
  | 'slider'
  | 'image'
  | 'widget'
  | 'browser_check'
  | 'unknown'
  | 'none';

export type CaptchaEvidenceSource = 'url' | 'title' | 'text' | 'dom';
export type CaptchaEvidenceStrength = 'weak' | 'strong';
export type CaptchaRecommendation =
  | 'continue'
  | 'observe'
  | 'ask_ai'
  | 'manual';

export interface CaptchaEvidence {
  ruleId: string;
  source: CaptchaEvidenceSource;
  strength: CaptchaEvidenceStrength;
  summary: string;
  kind?: Exclude<CaptchaKind, 'none'>;
  selector?: string;
}

export interface CaptchaAssessment {
  status: CaptchaStatus;
  detected: boolean;
  kind: CaptchaKind;
  confidence: number;
  evidence: CaptchaEvidence[];
  exclusions: CaptchaEvidence[];
  recommendation: CaptchaRecommendation;
  page: {
    url: string;
    title: string;
  };
}

export interface CaptchaWaitResult {
  cleared: boolean;
  elapsedMs: number;
  checks: number;
  assessment: CaptchaAssessment;
}

export interface CaptchaElementSnapshot {
  tagName: string;
  id: string;
  className: string;
  role: string;
  ariaLabel: string;
  src: string;
  title: string;
  alt: string;
  visible: boolean;
  hasSiteKey: boolean;
  draggable: boolean;
}

export interface CaptchaPageSnapshot {
  bodyText: string;
  elements: CaptchaElementSnapshot[];
}

export interface CaptchaAssessmentInput {
  url: string;
  title: string;
  snapshot: CaptchaPageSnapshot;
}
```

- [ ] **Step 4: Add the minimum pure rules implementation**

Create src/modules/captcha/rules.ts:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CaptchaAssessment,
  CaptchaAssessmentInput,
  CaptchaElementSnapshot,
  CaptchaEvidence,
  CaptchaEvidenceSource,
  CaptchaKind,
} from './types.js';

interface PhraseRule {
  id: string;
  source: Exclude<CaptchaEvidenceSource, 'dom'>;
  pattern: RegExp;
  summary: string;
  kind: Exclude<CaptchaKind, 'none'>;
}

const SOURCE_RANK: Record<CaptchaEvidenceSource, number> = {
  dom: 0,
  url: 1,
  title: 2,
  text: 3,
};

const SAFE_SELECTOR_TAGS = new Set([
  'a',
  'article',
  'aside',
  'button',
  'canvas',
  'dialog',
  'div',
  'fieldset',
  'form',
  'img',
  'input',
  'label',
  'li',
  'main',
  'p',
  'section',
  'span',
  'svg',
  'table',
  'tbody',
  'td',
  'tr',
  'ul',
]);

const POSITIVE_RULES: readonly PhraseRule[] = [
  {
    id: 'url-explicit-challenge',
    source: 'url',
    pattern:
      /(?:^|[/._?#&=-])(?:captcha|human-challenge|bot-check|security-check)(?=$|[/._?#&=-])/i,
    summary: 'The page URL contains an explicit human-challenge path.',
    kind: 'unknown',
  },
  {
    id: 'url-browser-check',
    source: 'url',
    pattern:
      /(?:^|[/._?#&=-])(?:browser-check|browser-challenge)(?=$|[/._?#&=-])/i,
    summary: 'The page URL identifies a browser-check flow.',
    kind: 'browser_check',
  },
  {
    id: 'title-human-verification',
    source: 'title',
    pattern:
      /\b(?:human verification|verify you are human|prove you are human|bot check|security challenge)\b/i,
    summary: 'The page title explicitly describes human verification.',
    kind: 'unknown',
  },
  {
    id: 'title-human-verification-zh',
    source: 'title',
    pattern: /(?:人机验证|安全挑战|滑块验证)/,
    summary: 'The page title explicitly describes a human challenge.',
    kind: 'unknown',
  },
  {
    id: 'text-slider-instruction',
    source: 'text',
    pattern: /\b(?:drag|move)\s+(?:the\s+)?slider\b/i,
    summary: 'Visible text asks the user to move a slider.',
    kind: 'slider',
  },
  {
    id: 'text-image-selection',
    source: 'text',
    pattern: /\bselect\s+(?:all|the)\s+(?:matching\s+)?images?\b/i,
    summary: 'Visible text asks the user to select images.',
    kind: 'image',
  },
  {
    id: 'text-browser-check',
    source: 'text',
    pattern: /\b(?:checking|check)\s+your\s+browser\b/i,
    summary: 'Visible text describes a browser security check.',
    kind: 'browser_check',
  },
  {
    id: 'text-human-verification',
    source: 'text',
    pattern:
      /\b(?:verify|prove|confirm)\s+(?:that\s+)?you(?:'re| are)?\s+(?:a\s+)?human\b/i,
    summary: 'Visible text explicitly asks for human verification.',
    kind: 'unknown',
  },
  {
    id: 'text-slider-instruction-zh',
    source: 'text',
    pattern: /(?:拖动|滑动).{0,8}滑块/,
    summary: 'Visible text asks the user to move a slider.',
    kind: 'slider',
  },
  {
    id: 'text-image-selection-zh',
    source: 'text',
    pattern: /(?:请选择|选择).{0,8}(?:图片|图像)/,
    summary: 'Visible text asks the user to select images.',
    kind: 'image',
  },
  {
    id: 'text-browser-check-zh',
    source: 'text',
    pattern: /(?:正在)?检查.{0,4}浏览器/,
    summary: 'Visible text describes a browser security check.',
    kind: 'browser_check',
  },
  {
    id: 'text-human-verification-zh',
    source: 'text',
    pattern: /(?:人机验证|请证明您是人类)/,
    summary: 'Visible text explicitly asks for human verification.',
    kind: 'unknown',
  },
];

const EXCLUSION_RULES: readonly PhraseRule[] = [
  {
    id: 'url-account-verification',
    source: 'url',
    pattern:
      /(?:verify-email|email-verification|verify-phone|phone-verification|account-activation|reset-password)/i,
    summary: 'The URL belongs to an account verification flow.',
    kind: 'unknown',
  },
  {
    id: 'title-account-code',
    source: 'title',
    pattern:
      /\b(?:verification|security|one[- ]time|sms|email|authenticator)\s+code\b/i,
    summary: 'The title describes an account or one-time code.',
    kind: 'unknown',
  },
  {
    id: 'title-two-factor',
    source: 'title',
    pattern: /\b(?:two-factor authentication|2fa)\b/i,
    summary: 'The title describes two-factor authentication.',
    kind: 'unknown',
  },
  {
    id: 'text-account-code',
    source: 'text',
    pattern:
      /\b(?:enter|send|request|receive).{0,24}(?:verification|one[- ]time|sms|email|authenticator)\s+code\b/i,
    summary: 'Visible text describes an account or one-time code.',
    kind: 'unknown',
  },
  {
    id: 'text-two-factor',
    source: 'text',
    pattern: /\b(?:two-factor authentication|2fa|authenticator code)\b/i,
    summary: 'Visible text describes two-factor authentication.',
    kind: 'unknown',
  },
  {
    id: 'text-account-code-zh',
    source: 'text',
    pattern: /(?:输入|获取|发送).{0,4}(?:短信|邮箱|手机)?验证码/,
    summary: 'Visible text describes an account verification code.',
    kind: 'unknown',
  },
  {
    id: 'text-two-factor-zh',
    source: 'text',
    pattern: /(?:双因素|两步)认证/,
    summary: 'Visible text describes two-factor authentication.',
    kind: 'unknown',
  },
];

function clip(value: string, limit: number): string {
  return value.slice(0, limit);
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function phraseEvidence(
  rule: PhraseRule,
  strength: CaptchaEvidence['strength'] = 'weak',
): CaptchaEvidence {
  return {
    ruleId: rule.id,
    source: rule.source,
    strength,
    summary: rule.summary,
    kind: rule.kind,
  };
}

function safeSelector(candidate: CaptchaElementSnapshot): string {
  if (candidate.hasSiteKey) return '[data-sitekey]';
  const tagName = normalize(candidate.tagName);
  if (tagName === 'iframe') return 'iframe';
  const safeTagName = SAFE_SELECTOR_TAGS.has(tagName) ? tagName : '*';
  const role = normalize(candidate.role);
  if (role === 'slider') {
    return safeTagName + '[role="slider"]';
  }
  return safeTagName;
}

function classifyDomCandidate(
  candidate: CaptchaElementSnapshot,
): CaptchaEvidence | null {
  if (!candidate.visible) return null;

  const tagName = normalize(candidate.tagName);
  const descriptor = normalize(
    [
      candidate.id,
      candidate.className,
      candidate.role,
      candidate.ariaLabel,
      candidate.src,
      candidate.title,
      candidate.alt,
    ].join(' '),
  );
  const selector = safeSelector({...candidate, tagName});
  const explicitChallenge =
    /captcha|\bchallenge\b|human[-\s]?challenge|bot[-\s]?check|人机验证|安全挑战/.test(
      descriptor,
    );
  const widgetSignal =
    tagName === 'iframe' &&
    /captcha|human[-\s]?challenge|verification[-\s]?challenge|verify.{0,12}human|human.{0,12}verification|人机验证/.test(
      descriptor,
    );
  const sliderSignal =
    candidate.draggable ||
    normalize(candidate.role) === 'slider' ||
    /slider|drag|slide|滑块|拖动/.test(descriptor);
  const imageSignal =
    tagName === 'img' &&
    /captcha[-\s]?(?:image|img)|image[-\s]?captcha|验证码图片|图形验证码/.test(
      descriptor,
    );
  const browserSignal =
    /browser[-\s]?(?:check|challenge)|checking[-\s]?browser|security[-\s]?(?:check|challenge)|浏览器(?:检查|验证)/.test(
      descriptor,
    );

  if (candidate.hasSiteKey || widgetSignal) {
    return {
      ruleId: 'dom-human-widget',
      source: 'dom',
      strength: 'strong',
      summary: 'A visible embedded human-challenge widget is present.',
      kind: 'widget',
      selector,
    };
  }
  if (explicitChallenge && sliderSignal) {
    return {
      ruleId: 'dom-slider-challenge',
      source: 'dom',
      strength: 'strong',
      summary: 'A visible challenge element has slider interaction semantics.',
      kind: 'slider',
      selector,
    };
  }
  if (imageSignal) {
    return {
      ruleId: 'dom-image-challenge',
      source: 'dom',
      strength: 'strong',
      summary:
        'A visible image element is explicitly identified as a challenge.',
      kind: 'image',
      selector,
    };
  }
  if (browserSignal) {
    return {
      ruleId: 'dom-browser-check',
      source: 'dom',
      strength: 'strong',
      summary:
        'A visible element explicitly identifies a browser security check.',
      kind: 'browser_check',
      selector,
    };
  }
  if (explicitChallenge || /\b(?:verify|challenge)\b|验证/.test(descriptor)) {
    return {
      ruleId: 'dom-generic-challenge',
      source: 'dom',
      strength: 'weak',
      summary: 'A visible element has generic challenge semantics.',
      kind: 'unknown',
      selector,
    };
  }
  return null;
}

function dedupeAndSort(items: CaptchaEvidence[]): CaptchaEvidence[] {
  const unique = new Map<string, CaptchaEvidence>();
  for (const item of items) {
    const key =
      item.ruleId + '\u0000' + item.source + '\u0000' + (item.selector ?? '');
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort(
    (left, right) => SOURCE_RANK[left.source] - SOURCE_RANK[right.source],
  );
}

function recommendationFor(
  status: CaptchaAssessment['status'],
  hasExclusion: boolean,
): CaptchaAssessment['recommendation'] {
  if (status === 'detected') return 'manual';
  if (status === 'suspected') return hasExclusion ? 'ask_ai' : 'observe';
  return 'continue';
}

export function assessCaptchaSnapshot(
  input: CaptchaAssessmentInput,
): CaptchaAssessment {
  const url = clip(input.url, 2048);
  const title = clip(input.title, 256);
  const values = {
    url: normalize(url),
    title: normalize(title),
    text: normalize(clip(input.snapshot.bodyText, 4000)),
  };
  const rawEvidence: CaptchaEvidence[] = [];
  const rawExclusions: CaptchaEvidence[] = [];

  for (const candidate of input.snapshot.elements.slice(0, 32)) {
    const evidence = classifyDomCandidate(candidate);
    if (evidence) rawEvidence.push(evidence);
  }
  for (const rule of POSITIVE_RULES) {
    if (rule.pattern.test(values[rule.source])) {
      rawEvidence.push(phraseEvidence(rule));
    }
  }
  for (const rule of EXCLUSION_RULES) {
    if (rule.pattern.test(values[rule.source])) {
      rawExclusions.push(phraseEvidence(rule));
    }
  }

  const allEvidence = dedupeAndSort(rawEvidence);
  const allExclusions = dedupeAndSort(rawExclusions);
  const evidence = allEvidence.slice(0, 20);
  const exclusions = allExclusions.slice(0, 20);
  const positiveSources = new Set(allEvidence.map(item => item.source));
  const hasStrongDom = allEvidence.some(
    item => item.source === 'dom' && item.strength === 'strong',
  );
  const hasExclusion = allExclusions.length > 0;

  let status: CaptchaAssessment['status'];
  if (hasStrongDom) {
    status = 'detected';
  } else if (positiveSources.size >= 2 && !hasExclusion) {
    status = 'detected';
  } else if (evidence.length > 0) {
    status = 'suspected';
  } else {
    status = 'not_detected';
  }

  let confidence = 0;
  if (hasStrongDom) confidence = 95;
  else if (status === 'detected' && positiveSources.size >= 3) confidence = 90;
  else if (status === 'detected') confidence = 85;
  else if (status === 'suspected') confidence = hasExclusion ? 35 : 50;

  const typedEvidence =
    allEvidence.find(
      item =>
        item.source === 'dom' &&
        item.strength === 'strong' &&
        item.kind !== undefined &&
        item.kind !== 'unknown',
    ) ??
    allEvidence.find(
      item => item.kind !== undefined && item.kind !== 'unknown',
    );
  const kind: CaptchaKind =
    status === 'not_detected' ? 'none' : (typedEvidence?.kind ?? 'unknown');

  return {
    status,
    detected: status === 'detected',
    kind,
    confidence,
    evidence,
    exclusions,
    recommendation: recommendationFor(status, hasExclusion),
    page: {url, title},
  };
}
```

- [ ] **Step 5: Run the pure-rules test and verify GREEN**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js
```

Expected: PASS with five passing subtests and no warnings.

- [ ] **Step 6: Format only Task 1 files and rerun**

Run:

```powershell
npx --no-install prettier --write src/modules/captcha/types.ts src/modules/captcha/rules.ts tests/unit/modules/captcha/CaptchaRules.test.ts
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js
```

Expected: PASS after formatting.

- [ ] **Step 7: Commit Task 1**

```powershell
npm audit --audit-level=high
git add -- src/modules/captcha/types.ts src/modules/captcha/rules.ts tests/unit/modules/captcha/CaptchaRules.test.ts
git diff --cached --check
git commit -m "feat(captcha): add deterministic assessment rules"
```

---

### Task 2: Bounded page snapshot assessment

**Files:**

- Create: `src/modules/captcha/CaptchaDetector.ts`
- Create: `src/modules/captcha/index.ts`
- Create: `tests/unit/modules/captcha/CaptchaDetector.test.ts`
- Consume: `src/modules/captcha/rules.ts`
- Consume: `src/modules/captcha/types.ts`

**Interfaces:**

- Consumes: `assessCaptchaSnapshot(input: CaptchaAssessmentInput): CaptchaAssessment`.
- Produces: `new CaptchaDetector().assess(page: Page): Promise<CaptchaAssessment>`.
- Keeps `assessWithinDeadline(page: Page, timeoutMs: number)` private; Task 3 reuses it internally while tests exercise only public methods.
- Exports from `index.ts`: `CaptchaDetector` plus only the public types listed in the approved design.

- [ ] **Step 1: Write the failing page-sampling tests**

Create `tests/unit/modules/captcha/CaptchaDetector.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {CaptchaDetector} from '../../../../src/modules/captcha/CaptchaDetector.js';

import type {CaptchaPageSnapshot} from '../../../../src/modules/captcha/types.js';
import type {Page} from '../../../../src/third_party/index.js';

interface FakeStyle {
  display: string;
  visibility: string;
  opacity: string;
}

interface FakeElementOptions {
  tagName?: string;
  attributes?: Record<string, string>;
  connected?: boolean;
  rect?: {width: number; height: number};
  style?: Partial<FakeStyle>;
  draggable?: boolean;
  siteKeyValue?: string;
  throwOnValueRead?: boolean;
}

const EMPTY_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [],
};

const styles = new WeakMap<object, FakeStyle>();

function fakeElement(options: FakeElementOptions = {}): Element {
  const attributes = options.attributes ?? {};
  const element = {
    tagName: options.tagName ?? 'DIV',
    isConnected: options.connected ?? true,
    draggable: options.draggable ?? false,
    hasAttribute: (name: string) =>
      name === 'data-sitekey'
        ? options.siteKeyValue !== undefined
        : Object.hasOwn(attributes, name),
    getAttribute: (name: string) => {
      if (name === 'data-sitekey' && options.siteKeyValue !== undefined) {
        throw new Error('data-sitekey value must never be read');
      }
      return attributes[name] ?? null;
    },
    getBoundingClientRect: () => options.rect ?? {width: 100, height: 40},
  };
  if (options.throwOnValueRead) {
    Object.defineProperty(element, 'value', {
      get: () => {
        throw new Error('input value must never be read');
      },
    });
  }
  styles.set(element, {
    display: options.style?.display ?? 'block',
    visibility: options.style?.visibility ?? 'visible',
    opacity: options.style?.opacity ?? '1',
  });
  return element as unknown as Element;
}

function runInFakeDom<T>(
  pageFunction: (arg: unknown) => T,
  arg: unknown,
  bodyText: string | null,
  elements: Element[],
): T {
  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: bodyText === null ? null : {innerText: bodyText},
      querySelectorAll: () => elements,
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      getComputedStyle: (element: object) => styles.get(element),
    },
  });
  try {
    return pageFunction(arg);
  } finally {
    if (documentDescriptor) {
      Object.defineProperty(globalThis, 'document', documentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

function pageReturning(
  snapshot: CaptchaPageSnapshot,
  overrides: {
    closed?: boolean;
    url?: () => string;
    title?: () => Promise<string>;
    evaluate?: Page['evaluate'];
  } = {},
): Page {
  return {
    isClosed: () => overrides.closed ?? false,
    url: overrides.url ?? (() => 'https://example.test/account'),
    title: overrides.title ?? (async () => 'Account'),
    evaluate:
      overrides.evaluate ??
      ((async () => snapshot) as unknown as Page['evaluate']),
  } as unknown as Page;
}

describe('CaptchaDetector.assess', () => {
  it('collects one bounded, privacy-safe, product-neutral snapshot', async () => {
    const secret = 'private-site-key';
    const candidates = Array.from({length: 33}, (_, index) =>
      fakeElement({
        tagName: index === 0 ? 'DIV' : index === 8 ? 'IFRAME' : 'INPUT',
        attributes: {
          id: index === 8 ? 'private-iframe-id' : 'i'.repeat(300),
          class:
            index === 0
              ? 'human-challenge'
              : index === 8
                ? 'private-iframe-class'
                : 'volume-range',
          role: index === 0 ? '' : index === 8 ? 'private-role' : 'slider',
          src:
            index === 8
              ? 'https://example.test/human-challenge'
              : 's'.repeat(3000),
          title: index === 0 || index === 8 ? 'human challenge' : '',
          'aria-label': index === 8 ? 'private iframe label' : '',
          alt: index === 8 ? 'private iframe alt' : '',
        },
        siteKeyValue: index === 0 ? secret : undefined,
        throwOnValueRead: true,
        connected: index === 5 ? false : undefined,
        rect:
          index === 6
            ? {width: 0, height: 40}
            : index === 7
              ? {width: 100, height: 0}
              : undefined,
        style:
          index === 1
            ? {display: 'none'}
            : index === 2
              ? {visibility: 'hidden'}
              : index === 3
                ? {visibility: 'collapse'}
                : index === 4
                  ? {opacity: '0'}
                  : undefined,
      }),
    );
    let evaluateCalls = 0;
    let selector = '';
    let captured: CaptchaPageSnapshot | undefined;
    const evaluate = (async (
      pageFunction: (arg: unknown) => CaptchaPageSnapshot,
      arg: {candidateSelector: string},
    ) => {
      evaluateCalls++;
      selector = arg.candidateSelector;
      captured = runInFakeDom(
        pageFunction,
        arg,
        '拖动滑块完成验证 ' + 'x'.repeat(5000),
        candidates,
      );
      return captured;
    }) as unknown as Page['evaluate'];

    const result = await new CaptchaDetector().assess(
      pageReturning(EMPTY_SNAPSHOT, {evaluate}),
    );

    assert.equal(evaluateCalls, 1);
    assert.equal(captured?.bodyText.length, 4000);
    assert.equal(captured?.elements.length, 32);
    assert.equal(captured?.elements[0]?.id.length, 256);
    assert.equal(captured?.elements[0]?.src.length, 2048);
    assert.equal(captured?.elements[0]?.hasSiteKey, true);
    assert.deepEqual(
      captured?.elements.slice(1, 8).map(element => element.visible),
      [false, false, false, false, false, false, false],
    );
    assert.deepEqual(captured?.elements[8], {
      tagName: 'iframe',
      id: '',
      className: '',
      role: '',
      ariaLabel: '',
      src: 'https://example.test/human-challenge',
      title: 'human challenge',
      alt: '',
      visible: true,
      hasSiteKey: false,
      draggable: false,
    });
    assert.match(selector, /data-sitekey/);
    assert.match(selector, /role="slider"/);
    assert.doesNotMatch(
      selector,
      /recaptcha|hcaptcha|turnstile|geetest|cloudflare/i,
    );
    assert.equal(result.status, 'detected');
    assert.equal(result.kind, 'widget');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  });

  it('rejects closed pages and critical read failures', async () => {
    const detector = new CaptchaDetector();
    await assert.rejects(
      detector.assess(pageReturning(EMPTY_SNAPSHOT, {closed: true})),
      /closed/i,
    );
    await assert.rejects(
      detector.assess(
        pageReturning(EMPTY_SNAPSHOT, {
          title: async () => {
            throw new Error('title unavailable');
          },
        }),
      ),
      /title unavailable/,
    );
    await assert.rejects(
      detector.assess(
        pageReturning(EMPTY_SNAPSHOT, {
          url: () => {
            throw new Error('url unavailable');
          },
        }),
      ),
      /url unavailable/,
    );
    await assert.rejects(
      detector.assess(
        pageReturning(EMPTY_SNAPSHOT, {
          evaluate: (async () => {
            throw new Error('dom unavailable');
          }) as Page['evaluate'],
        }),
      ),
      /dom unavailable/,
    );
  });

  it('treats a missing document body as empty visible text', async () => {
    const evaluate = (async (
      pageFunction: (arg: unknown) => CaptchaPageSnapshot,
      arg: unknown,
    ) =>
      runInFakeDom(pageFunction, arg, null, [])) as unknown as Page['evaluate'];

    const result = await new CaptchaDetector().assess(
      pageReturning(EMPTY_SNAPSHOT, {evaluate}),
    );

    assert.equal(result.status, 'not_detected');
    assert.equal(result.evidence.length, 0);
  });

  it('enforces one shared five-second deadline and clears its timer', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const never = new Promise<string>(() => undefined);
      const pending = assert.rejects(
        new CaptchaDetector().assess(
          pageReturning(EMPTY_SNAPSHOT, {title: () => never}),
        ),
        /CAPTCHA assessment timed out after 5000ms/,
      );

      await clock.tickAsync(5000);
      await pending;
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });
});
```

These tests deliberately execute the browser callback instead of mocking its result. They fail if the implementation reads an input value or the `data-sitekey` value, performs more than one `evaluate`, captures more than 32 candidates, exceeds a field bound, introduces provider-specific selectors, accepts a critical partial read, or leaks a timeout timer.

- [ ] **Step 2: Run the page-sampling test and verify RED**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaDetector.test.js
```

Expected: FAIL because `CaptchaDetector.js` does not exist.

- [ ] **Step 3: Add bounded snapshot acquisition and the assessment deadline**

Create `src/modules/captcha/CaptchaDetector.ts`:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {assessCaptchaSnapshot} from './rules.js';

import type {Page} from '../../third_party/index.js';
import type {CaptchaAssessment, CaptchaPageSnapshot} from './types.js';

const ASSESS_TIMEOUT_MS = 5000;
const MAX_BODY_TEXT_LENGTH = 4000;
const MAX_ELEMENTS = 32;
const MAX_ATTRIBUTE_LENGTH = 256;
const MAX_SRC_LENGTH = 2048;

const CANDIDATE_SELECTOR = [
  '[data-sitekey]',
  '[role="slider"]',
  '[draggable="true"]',
  '[id*="captcha" i]',
  '[class*="captcha" i]',
  '[id*="challenge" i]',
  '[class*="challenge" i]',
  '[aria-label*="captcha" i]',
  '[aria-label*="challenge" i]',
  '[title*="captcha" i]',
  '[title*="challenge" i]',
  '[id*="browser-check" i]',
  '[class*="browser-check" i]',
  '[id*="security-check" i]',
  '[class*="security-check" i]',
  'iframe[src*="captcha" i]',
  'iframe[src*="challenge" i]',
  'iframe[title*="human" i]',
  'iframe[title*="verify" i]',
  'img[alt*="captcha" i]',
  'img[alt*="challenge" i]',
].join(',');

interface SnapshotOptions {
  candidateSelector: string;
  maxBodyTextLength: number;
  maxElements: number;
  maxAttributeLength: number;
  maxSrcLength: number;
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class CaptchaDetector {
  async assess(page: Page): Promise<CaptchaAssessment> {
    return this.assessWithinDeadline(page, ASSESS_TIMEOUT_MS);
  }

  private async assessWithinDeadline(
    page: Page,
    timeoutMs: number,
  ): Promise<CaptchaAssessment> {
    if (page.isClosed()) {
      throw new Error('Target page, context or browser has been closed');
    }
    const url = page.url();

    const reads = Promise.all([
      page.title(),
      page.evaluate(
        (options: SnapshotOptions): CaptchaPageSnapshot => {
          const clip = (value: string | null, limit: number) =>
            (value ?? '').slice(0, limit);
          const isVisible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return (
              element.isConnected &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.visibility !== 'collapse' &&
              Number.parseFloat(style.opacity) > 0
            );
          };

          // ponytail: Inspect only the top-level DOM and iframe metadata; add explicit
          // frame/shadow traversal only after a reproducible miss demonstrates the need.
          const elements = Array.from(
            document.querySelectorAll(options.candidateSelector),
          )
            .slice(0, options.maxElements)
            .map(element => {
              const tagName = element.tagName.toLowerCase();
              const isIframe = tagName === 'iframe';
              return {
                tagName,
                id: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('id'),
                      options.maxAttributeLength,
                    ),
                className: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('class'),
                      options.maxAttributeLength,
                    ),
                role: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('role'),
                      options.maxAttributeLength,
                    ),
                ariaLabel: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('aria-label'),
                      options.maxAttributeLength,
                    ),
                src: clip(element.getAttribute('src'), options.maxSrcLength),
                title: clip(
                  element.getAttribute('title'),
                  options.maxAttributeLength,
                ),
                alt: isIframe
                  ? ''
                  : clip(
                      element.getAttribute('alt'),
                      options.maxAttributeLength,
                    ),
                visible: isVisible(element),
                hasSiteKey: !isIframe && element.hasAttribute('data-sitekey'),
                draggable:
                  !isIframe &&
                  (element.getAttribute('draggable') === 'true' ||
                    (element as {draggable?: boolean}).draggable === true),
              };
            });

          return {
            bodyText: (document.body?.innerText ?? '').slice(
              0,
              options.maxBodyTextLength,
            ),
            elements,
          };
        },
        {
          candidateSelector: CANDIDATE_SELECTOR,
          maxBodyTextLength: MAX_BODY_TEXT_LENGTH,
          maxElements: MAX_ELEMENTS,
          maxAttributeLength: MAX_ATTRIBUTE_LENGTH,
          maxSrcLength: MAX_SRC_LENGTH,
        },
      ),
    ]);
    const [title, snapshot] = await withDeadline(
      reads,
      timeoutMs,
      () => new Error('CAPTCHA assessment timed out after ' + timeoutMs + 'ms'),
    );

    return assessCaptchaSnapshot({url, title, snapshot});
  }
}
```

This callback intentionally reads no `value`, cookies, storage, full HTML, shadow root, frame content, screenshot, or site-key value. Do not broaden the selector or returned object while making the test compile.

- [ ] **Step 4: Add the stable public module exports**

Create `src/modules/captcha/index.ts`:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export {CaptchaDetector} from './CaptchaDetector.js';
export type {
  CaptchaAssessment,
  CaptchaEvidence,
  CaptchaEvidenceSource,
  CaptchaEvidenceStrength,
  CaptchaKind,
  CaptchaRecommendation,
  CaptchaStatus,
  CaptchaWaitResult,
} from './types.js';
```

- [ ] **Step 5: Run the page-sampling and pure-rules tests and verify GREEN**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js
```

Expected: PASS with all Task 1 and Task 2 subtests. If TypeScript reports the overloaded `Page.evaluate` fake signature, keep the cast at the fake boundary; do not weaken production types.

- [ ] **Step 6: Format only Task 2 files and rerun**

Run:

```powershell
npx --no-install prettier --write src/modules/captcha/CaptchaDetector.ts src/modules/captcha/index.ts tests/unit/modules/captcha/CaptchaDetector.test.ts
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js
```

Expected: PASS after formatting.

- [ ] **Step 7: Commit Task 2**

```powershell
npm audit --audit-level=high
git add -- src/modules/captcha/CaptchaDetector.ts src/modules/captcha/index.ts tests/unit/modules/captcha/CaptchaDetector.test.ts
git diff --cached --check
git commit -m "feat(captcha): assess bounded page snapshots"
```

---

### Task 3: Stable CAPTCHA-clear wait state machine

**Files:**

- Modify: `src/modules/captcha/CaptchaDetector.ts`
- Modify: `tests/unit/modules/captcha/CaptchaDetector.test.ts`
- Test: `tests/unit/modules/captcha/CaptchaDetector.test.ts`

**Interfaces:**

- Consumes: `CaptchaAssessment` and `CaptchaWaitResult` from `types.ts`.
- Consumes internally: Task 2's private `assessWithinDeadline(page, timeoutMs)` path; tests drive it through public `waitForClear`.
- Produces: `waitForClear(page: Page, timeoutMs?: number): Promise<CaptchaWaitResult>`.
- Default timeout: 300,000 ms. Poll interval: 2,000 ms. Maximum consecutive transient navigation errors: 3.

- [ ] **Step 1: Add failing wait-state tests**

In `tests/unit/modules/captcha/CaptchaDetector.test.ts`, add `CaptchaStatus` to the existing type imports and append the following after the `CaptchaDetector.assess` suite. The sequenced Page double drives the real detector; no private method is exposed or overridden for coverage:

```ts
type SequenceOutcome = CaptchaStatus | Error;

const STRONG_WIDGET_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [
    {
      tagName: 'div',
      id: '',
      className: '',
      role: '',
      ariaLabel: '',
      src: '',
      title: '',
      alt: '',
      visible: true,
      hasSiteKey: true,
      draggable: false,
    },
  ],
};

function sequencedPage(outcomes: readonly SequenceOutcome[]): {
  page: Page;
  calls: () => number;
} {
  let calls = 0;
  let current: SequenceOutcome | undefined;
  const page = {
    isClosed: () => false,
    url: () => 'https://example.test/account',
    title: async () => {
      current = outcomes[Math.min(calls++, outcomes.length - 1)];
      if (!current) throw new Error('test sequence must not be empty');
      if (current instanceof Error) throw current;
      return current === 'suspected'
        ? 'Human verification required'
        : 'Account';
    },
    evaluate: async () =>
      current === 'detected' ? STRONG_WIDGET_SNAPSHOT : EMPTY_SNAPSHOT,
  } as unknown as Page;
  return {page, calls: () => calls};
}

const TRANSIENT_ERROR = new Error(
  'Execution context was destroyed by navigation',
);

describe('CaptchaDetector.waitForClear', () => {
  it('returns immediately when the initial assessment is clear', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage(['not_detected']);
      const result = await new CaptchaDetector().waitForClear(sequence.page);

      assert.equal(result.cleared, true);
      assert.equal(result.elapsedMs, 0);
      assert.equal(result.checks, 1);
      assert.equal(sequence.calls(), 1);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('requires two consecutive clear assessments after a challenge', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        'detected',
        'not_detected',
        'not_detected',
      ]);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 10000);

      await clock.tickAsync(4000);
      const result = await pending;

      assert.equal(result.cleared, true);
      assert.equal(result.elapsedMs, 4000);
      assert.equal(result.checks, 3);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('resets the clear streak for suspected and detected results', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        'detected',
        'not_detected',
        'suspected',
        'not_detected',
        'detected',
        'not_detected',
        'not_detected',
      ]);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 15000);

      await clock.tickAsync(12000);
      const result = await pending;

      assert.equal(result.cleared, true);
      assert.equal(result.checks, 7);
      assert.equal(result.elapsedMs, 12000);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('returns the last successful assessment when the budget expires', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage(['detected', 'suspected']);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 5000);

      await clock.tickAsync(5000);
      const result = await pending;

      assert.equal(result.cleared, false);
      assert.equal(result.elapsedMs, 5000);
      assert.equal(result.checks, 3);
      assert.equal(result.assessment.status, 'suspected');
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('retries three transient errors and resets that count after success', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        'detected',
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        'not_detected',
        'not_detected',
      ]);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 20000);

      await clock.tickAsync(16000);
      const result = await pending;

      assert.equal(result.cleared, true);
      assert.equal(result.checks, 9);
      assert.equal(sequence.calls(), 9);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('fails on the fourth transient error and on non-transient errors', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const transientSequence = sequencedPage([
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
      ]);
      const transientFailure = assert.rejects(
        new CaptchaDetector().waitForClear(transientSequence.page, 20000),
        /Execution context was destroyed/,
      );
      await clock.tickAsync(6000);
      await transientFailure;
      assert.equal(transientSequence.calls(), 4);
      assert.equal(clock.countTimers(), 0);

      const fatalSequence = sequencedPage([new Error('permission denied')]);
      await assert.rejects(
        new CaptchaDetector().waitForClear(fatalSequence.page),
        /permission denied/,
      );
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('fails if the page closes or the budget has no successful assessment', async () => {
    await assert.rejects(
      new CaptchaDetector().waitForClear(
        pageReturning(EMPTY_SNAPSHOT, {closed: true}),
      ),
      /closed/i,
    );

    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
      ]);
      const pending = assert.rejects(
        new CaptchaDetector().waitForClear(sequence.page, 5000),
        /before a successful assessment/,
      );
      await clock.tickAsync(5000);
      await pending;
      assert.equal(sequence.calls(), 3);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('rejects non-positive, fractional, and non-finite module timeouts', async () => {
    const page = sequencedPage(['not_detected']).page;
    for (const timeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        new CaptchaDetector().waitForClear(page, timeout),
        RangeError,
      );
    }
  });
});
```

The timeout test repeats its last `suspected` outcome, so three attempts occur at 0, 2,000, and 4,000 ms before the final 1,000 ms sleep consumes the budget. The transient-error test proves that `checks` includes errors and that one successful assessment resets the consecutive-error counter.

- [ ] **Step 2: Run the wait tests and verify RED**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaDetector.test.js
```

Expected: FAIL because `waitForClear` does not exist.

- [ ] **Step 3: Add the wait constants and helpers**

In `src/modules/captcha/CaptchaDetector.ts`, extend the type import with `CaptchaWaitResult` and add these declarations after `ASSESS_TIMEOUT_MS`:

```ts
const DEFAULT_WAIT_TIMEOUT_MS = 300000;
const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_TRANSIENT_ERRORS = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientNavigationError(error: unknown): boolean {
  return /execution context.*destroyed|cannot find context|frame.*detached/i.test(
    errorMessage(error),
  );
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}
```

The complete affected import becomes:

```ts
import type {
  CaptchaAssessment,
  CaptchaPageSnapshot,
  CaptchaWaitResult,
} from './types.js';
```

- [ ] **Step 4: Add the stable-clear state machine**

Add this public method inside `CaptchaDetector` after `assess` and before `assessWithinDeadline`:

```ts
  async waitForClear(
    page: Page,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<CaptchaWaitResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive integer');
    }

    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let checks = 0;
    let clearStreak = 0;
    let challengeObserved = false;
    let consecutiveTransientErrors = 0;
    let lastAssessment: CaptchaAssessment | undefined;

    const timedOut = (): CaptchaWaitResult => {
      if (!lastAssessment) {
        throw new Error(
          'CAPTCHA wait timed out before a successful assessment',
        );
      }
      return {
        cleared: false,
        elapsedMs: Date.now() - startedAt,
        checks,
        assessment: lastAssessment,
      };
    };

    while (true) {
      if (page.isClosed()) {
        throw new Error('Target page, context or browser has been closed');
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return timedOut();

      checks++;
      try {
        const assessment = await this.assessWithinDeadline(
          page,
          Math.min(ASSESS_TIMEOUT_MS, remaining),
        );
        lastAssessment = assessment;
        consecutiveTransientErrors = 0;

        if (assessment.status === 'not_detected') {
          if (!challengeObserved) {
            return {
              cleared: true,
              elapsedMs: Date.now() - startedAt,
              checks,
              assessment,
            };
          }
          clearStreak++;
          if (clearStreak === 2) {
            return {
              cleared: true,
              elapsedMs: Date.now() - startedAt,
              checks,
              assessment,
            };
          }
        } else {
          challengeObserved = true;
          clearStreak = 0;
        }
      } catch (error) {
        if (page.isClosed()) {
          throw new Error('Target page, context or browser has been closed');
        }
        if (Date.now() >= deadline) return timedOut();
        if (!isTransientNavigationError(error)) throw error;

        clearStreak = 0;
        consecutiveTransientErrors++;
        if (
          consecutiveTransientErrors > MAX_CONSECUTIVE_TRANSIENT_ERRORS
        ) {
          throw error;
        }
      }

      const sleepBudget = deadline - Date.now();
      if (sleepBudget <= 0) return timedOut();
      await delay(Math.min(POLL_INTERVAL_MS, sleepBudget));
    }
  }
```

The method intentionally calls `assessWithinDeadline` with the remaining total budget instead of wrapping public `assess` in a second timeout. This leaves only one owned assessment timer, so a short wait timeout cannot strand the normal five-second timer.

- [ ] **Step 5: Run the detector tests and verify GREEN**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaDetector.test.js
```

Expected: PASS, including exact elapsed times under fake timers and `clock.countTimers() === 0`.

- [ ] **Step 6: Format the detector files and rerun both module tests**

Run:

```powershell
npx --no-install prettier --write src/modules/captcha/CaptchaDetector.ts tests/unit/modules/captcha/CaptchaDetector.test.ts
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
npm audit --audit-level=high
git add -- src/modules/captcha/CaptchaDetector.ts tests/unit/modules/captcha/CaptchaDetector.test.ts
git diff --cached --check
git commit -m "feat(captcha): wait for stable challenge clearance"
```

---

### Task 4: Read-only `detect_captcha` MCP tool and registration

**Files:**

- Create: `src/tools/page/detectCaptcha.ts`
- Create: `tests/unit/tools/page/detectCaptcha.test.ts`
- Modify: `src/tools/page/manifest.ts`
- Modify: `src/tools/page/index.ts`
- Generate: `src/tools/generated-tools-index.ts` via `npm run build:index`

**Interfaces:**

- Consumes: `CaptchaDetector.assess(page)` and `CaptchaDetector.waitForClear(page, timeoutMs?)`.
- Consumes: `context.getSelectedPage(): Page | null`, `sendJson`, and `normalizeBrowserRuntimeError`.
- Produces: one tool named `detect_captcha` in `ToolCategory.PAGES` with `readOnlyHint: true`.
- Produces detect data: `{action: 'detect'; assessment: CaptchaAssessment}`.
- Produces wait data: `{action: 'wait_for_clear'; assessment: CaptchaAssessment; wait: {cleared: boolean; elapsedMs: number; checks: number}}`.

- [ ] **Step 1: Write the failing adapter and registration tests**

Create `tests/unit/tools/page/detectCaptcha.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {zod} from '../../../../src/third_party/index.js';
import {ToolCategory} from '../../../../src/tools/categories.js';
import {GENERATED_TOOL_REGISTRY} from '../../../../src/tools/generated-tools-index.js';
import {detectCaptcha} from '../../../../src/tools/page/detectCaptcha.js';
import * as pageTools from '../../../../src/tools/page/index.js';
import {manifest as pageManifest} from '../../../../src/tools/page/manifest.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

import type {CaptchaPageSnapshot} from '../../../../src/modules/captcha/types.js';
import type {Page} from '../../../../src/third_party/index.js';

interface CaptchaToolPayload {
  success: boolean;
  message: string;
  tooltype: string;
  data?: {
    action: 'detect' | 'wait_for_clear';
    assessment: {
      status: string;
      detected: boolean;
    };
    wait?: {
      cleared: boolean;
      elapsedMs: number;
      checks: number;
    };
  };
}

const EMPTY_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [],
};

const WIDGET_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [
    {
      tagName: 'div',
      id: '',
      className: '',
      role: '',
      ariaLabel: '',
      src: '',
      title: '',
      alt: '',
      visible: true,
      hasSiteKey: true,
      draggable: false,
    },
  ],
};

function pageReturning(
  snapshot: CaptchaPageSnapshot,
  overrides: {
    closed?: boolean;
    title?: () => Promise<string>;
  } = {},
): Page {
  return {
    isClosed: () => overrides.closed ?? false,
    url: () => 'https://example.test/account',
    title: overrides.title ?? (async () => 'Account'),
    evaluate: async () => snapshot,
  } as unknown as Page;
}

function payload(response: ToolResponseAccumulator): CaptchaToolPayload {
  return response.toJSON().structuredContent as CaptchaToolPayload;
}

async function runTool(
  params: {action?: 'detect' | 'wait_for_clear'; timeout?: number},
  page: Page | null,
): Promise<CaptchaToolPayload> {
  const response = new ToolResponseAccumulator();
  const context = {
    getSelectedPage: () => page,
  } as Parameters<typeof detectCaptcha.handler>[2];
  const parsed = zod.object(detectCaptcha.schema).parse(params);
  await detectCaptcha.handler({params: parsed}, response, context);
  return payload(response);
}

describe('detect_captcha schema and registration', () => {
  it('declares a read-only Pages tool with bounded input', () => {
    assert.equal(detectCaptcha.name, 'detect_captcha');
    assert.deepEqual(detectCaptcha.annotations, {
      category: ToolCategory.PAGES,
      readOnlyHint: true,
    });

    const schema = zod.object(detectCaptcha.schema);
    assert.deepEqual(schema.parse({}), {action: 'detect'});
    assert.deepEqual(schema.parse({action: 'wait_for_clear'}), {
      action: 'wait_for_clear',
    });
    for (const timeout of [999, 300001, 1000.5]) {
      assert.equal(
        schema.safeParse({action: 'wait_for_clear', timeout}).success,
        false,
      );
    }
    assert.equal(
      schema.safeParse({action: 'wait_for_clear', timeout: 300000}).success,
      true,
    );
  });

  it('is exported and registered exactly once', () => {
    assert.equal(pageTools.detectCaptcha, detectCaptcha);
    assert.equal(
      pageManifest.tools.filter(entry => entry.handlerName === 'detectCaptcha')
        .length,
      1,
    );
    assert.equal(
      GENERATED_TOOL_REGISTRY.filter(
        entry => entry.handlerName === 'detectCaptcha',
      ).length,
      1,
    );
  });
});

describe('detect_captcha handler', () => {
  it('fails clearly when no page is selected', async () => {
    const result = await runTool({}, null);

    assert.equal(result.success, false);
    assert.equal(result.tooltype, 'detect_captcha');
    assert.match(result.message, /select_page/);
  });

  it('defaults to detect and treats a detected challenge as success', async () => {
    const result = await runTool({}, pageReturning(WIDGET_SNAPSHOT));

    assert.equal(result.success, true);
    assert.equal(result.data?.action, 'detect');
    assert.equal(result.data?.assessment.status, 'detected');
    assert.equal(result.data?.assessment.detected, true);
    assert.equal(result.data?.wait, undefined);
  });

  it('returns an immediate successful wait result for an initially clear page', async () => {
    const result = await runTool(
      {action: 'wait_for_clear', timeout: 1000},
      pageReturning(EMPTY_SNAPSHOT),
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.action, 'wait_for_clear');
    assert.equal(result.data?.wait?.cleared, true);
    assert.equal(result.data?.wait?.checks, 1);
    assert.equal(result.data?.assessment.status, 'not_detected');
  });

  it('keeps wait timeout as a successful domain result', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const pending = runTool(
        {action: 'wait_for_clear', timeout: 5000},
        pageReturning(WIDGET_SNAPSHOT),
      );

      await clock.tickAsync(5000);
      const result = await pending;

      assert.equal(result.success, true);
      assert.equal(result.data?.wait?.cleared, false);
      assert.equal(result.data?.wait?.elapsedMs, 5000);
      assert.equal(result.data?.wait?.checks, 3);
      assert.equal(result.data?.assessment.status, 'detected');
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('ignores detect-only timeout and sanitizes unexpected page errors', async () => {
    const detectWithWaitTimeout = await runTool(
      {action: 'detect', timeout: 1000},
      pageReturning(EMPTY_SNAPSHOT),
    );
    assert.equal(detectWithWaitTimeout.success, true);
    assert.equal(detectWithWaitTimeout.data?.action, 'detect');
    assert.equal(detectWithWaitTimeout.data?.assessment.status, 'not_detected');

    const secret = 'private-page-body-secret';
    const failed = await runTool(
      {},
      pageReturning(EMPTY_SNAPSHOT, {
        title: async () => {
          throw new Error(secret);
        },
      }),
    );
    assert.equal(failed.success, false);
    assert.match(failed.message, /无法读取当前页面/);
    assert.doesNotMatch(failed.message, new RegExp(secret));
  });

  it('normalizes closed-page failures without exposing raw details', async () => {
    const result = await runTool(
      {},
      pageReturning(EMPTY_SNAPSHOT, {closed: true}),
    );

    assert.equal(result.success, false);
    assert.match(result.message, /已关闭/);
    assert.doesNotMatch(result.message, /Target page/);
  });

  it('maps connection, navigation, and assessment-timeout failures safely', async () => {
    const cases = [
      {
        raw: 'fetch failed private-detail',
        expected: /浏览器连接失败/,
      },
      {
        raw: 'Execution context was destroyed private-detail',
        expected: /执行上下文已销毁/,
      },
    ];
    for (const sample of cases) {
      const result = await runTool(
        {},
        pageReturning(EMPTY_SNAPSHOT, {
          title: async () => {
            throw new Error(sample.raw);
          },
        }),
      );
      assert.equal(result.success, false);
      assert.match(result.message, sample.expected);
      assert.doesNotMatch(result.message, /private-detail/);
    }

    const clock = sinon.useFakeTimers();
    try {
      const pending = runTool(
        {},
        pageReturning(EMPTY_SNAPSHOT, {
          title: () => new Promise<string>(() => undefined),
        }),
      );
      await clock.tickAsync(5000);
      const timedOut = await pending;
      assert.equal(timedOut.success, false);
      assert.match(timedOut.message, /评估超时/);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });
});
```

This file uses the real detector with deterministic Page doubles; the tool remains unmodified for test injection. The registration assertion must stay because `npm run build:dev` does not regenerate the tracked tool index.

- [ ] **Step 2: Run the tool test and verify RED**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/page/detectCaptcha.test.js
```

Expected: FAIL because `detectCaptcha.js` does not exist and no registration exists.

- [ ] **Step 3: Add the thin MCP adapter**

Create `src/tools/page/detectCaptcha.ts`:

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {CaptchaDetector} from '../../modules/captcha/index.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {normalizeBrowserRuntimeError} from '../shared/browserRuntime.js';
import {sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

const detector = new CaptchaDetector();

function safeCaptchaError(error: unknown): string {
  const normalized = normalizeBrowserRuntimeError(error);
  if (/浏览器连接失败/.test(normalized)) {
    return '浏览器连接失败，页面或 CDP 会话可能已失效。';
  }
  if (/已关闭/.test(normalized)) {
    return '当前页面、上下文或浏览器已关闭。';
  }
  if (/执行上下文已销毁/.test(normalized)) {
    return '页面刚发生导航，执行上下文已销毁。';
  }
  if (/timed out|超时/i.test(normalized)) {
    return 'CAPTCHA 页面评估超时。';
  }
  return '无法读取当前页面的 CAPTCHA 状态。';
}

export const detectCaptcha = defineTool({
  name: 'detect_captcha',
  description:
    '只读评估当前页面是否存在 CAPTCHA，并可等待挑战稳定清除；不会自动求解或操作页面。',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: true},
  schema: {
    action: zod
      .enum(['detect', 'wait_for_clear'])
      .default('detect')
      .describe('detect 立即评估；wait_for_clear 等待挑战稳定清除。'),
    timeout: zod
      .number()
      .int()
      .min(1000)
      .max(300000)
      .optional()
      .describe('wait_for_clear 的最长等待时间（毫秒，默认 300000）。'),
  },
  handler: async (request, response, context) => {
    const {action, timeout} = request.params;
    const page = context.getSelectedPage();
    if (!page) {
      sendJson(response, {
        success: false,
        message: '未选中页面，请先使用 select_page 选择目标页面。',
        tooltype: 'detect_captcha',
      });
      return;
    }
    try {
      if (action === 'wait_for_clear') {
        const result = await detector.waitForClear(page, timeout);
        sendJson(response, {
          success: true,
          message: result.cleared
            ? 'CAPTCHA 已稳定清除。'
            : '等待超时，CAPTCHA 尚未稳定清除。',
          tooltype: 'detect_captcha',
          data: {
            action,
            assessment: result.assessment,
            wait: {
              cleared: result.cleared,
              elapsedMs: result.elapsedMs,
              checks: result.checks,
            },
          },
        });
        return;
      }

      const assessment = await detector.assess(page);
      sendJson(response, {
        success: true,
        message: 'CAPTCHA 页面评估完成。',
        tooltype: 'detect_captcha',
        data: {action, assessment},
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: safeCaptchaError(error),
        tooltype: 'detect_captcha',
      });
    }
  },
});
```

Do not expose `safeCaptchaError` or the detector singleton. The fixed error mapping deliberately drops arbitrary raw error text so page data cannot escape through an exception message.

- [ ] **Step 4: Register the tool in the page domain**

In `src/tools/page/manifest.ts`, add this entry immediately after `waitForElement`:

```ts
    {modulePath: './page/detectCaptcha.js', handlerName: 'detectCaptcha'},
```

In `src/tools/page/index.ts`, add this export immediately after `waitForElement`:

```ts
export {detectCaptcha} from './detectCaptcha.js';
```

No change to `src/tools/page/types.ts` is needed because the new public domain types live in `src/modules/captcha/types.ts` and the tool definition infers its input.

- [ ] **Step 5: Generate the tracked tool index**

Run:

```powershell
npm run build:index
git diff -- src/tools/generated-tools-index.ts
```

Expected: `src/tools/generated-tools-index.ts` gains exactly one registry entry:

```ts
  {
    modulePath: './page/detectCaptcha.js',
    handlerName: 'detectCaptcha',
  },
```

No other manifest or unrelated registry entry may change. Do not edit the generated file by hand.

- [ ] **Step 6: Run the tool test and verify GREEN**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/page/detectCaptcha.test.js
```

Expected: PASS for schema, registration, missing-page, detect, wait-success, wait-timeout, and sanitized-error behavior.

- [ ] **Step 7: Run all CAPTCHA tests together**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js build/tests/unit/tools/page/detectCaptcha.test.js
```

Expected: PASS with no leaked fake timer.

- [ ] **Step 8: Format only Task 4 source/tests, regenerate, and rerun**

Run:

```powershell
npx --no-install prettier --write src/tools/page/detectCaptcha.ts src/tools/page/manifest.ts src/tools/page/index.ts tests/unit/tools/page/detectCaptcha.test.ts
npm run build:index
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js build/tests/unit/tools/page/detectCaptcha.test.js
```

Expected: PASS and the generated index remains stable.

- [ ] **Step 9: Commit Task 4**

```powershell
npm audit --audit-level=high
git add -- src/tools/page/detectCaptcha.ts src/tools/page/manifest.ts src/tools/page/index.ts src/tools/generated-tools-index.ts tests/unit/tools/page/detectCaptcha.test.ts
git diff --cached --check
git commit -m "feat(page): expose passive captcha detection"
```

---

### Task 5: Final-diff verification and evidence handoff

**Files:**

- Review: every file in the implementation diff from the fresh-worktree base.
- Modify: only a task-owned source or test if a verification failure proves that file is wrong.
- Do not create a new dependency, generated build artifact, PR, push, merge, or external change.

**Interfaces:**

- Consumes: all Task 1–4 commits and the approved design.
- Produces: fresh focused-test, coverage, typecheck, full-unit, format, security, generated-index, and diff evidence.
- Produces: the `close-code-change` handoff and `agent-self-evaluation` scorecard.

- [ ] **Step 1: Reconstruct and verify the implementation boundary**

Run from the isolated feature worktree:

```powershell
$implementationBase = git merge-base HEAD refactor
git status --short --branch
git diff --name-only $implementationBase..HEAD
```

Expected: the worktree is clean and the implementation diff contains only:

```text
src/modules/captcha/CaptchaDetector.ts
src/modules/captcha/index.ts
src/modules/captcha/rules.ts
src/modules/captcha/types.ts
src/tools/generated-tools-index.ts
src/tools/page/detectCaptcha.ts
src/tools/page/index.ts
src/tools/page/manifest.ts
tests/unit/modules/captcha/CaptchaDetector.test.ts
tests/unit/modules/captcha/CaptchaRules.test.ts
tests/unit/tools/page/detectCaptcha.test.ts
```

If `refactor` has moved since the worktree was created, use `git merge-base --fork-point refactor HEAD` as `$implementationBase`; do not widen the diff to unrelated commits.

- [ ] **Step 2: Prove the generated index is reproducible**

Run:

```powershell
npm run build:index
git diff --exit-code -- src/tools/generated-tools-index.ts
$generatedCount = (Select-String -LiteralPath src/tools/generated-tools-index.ts -Pattern "handlerName: 'detectCaptcha'").Count
if ($generatedCount -ne 1) { throw "Expected one generated detectCaptcha entry, found $generatedCount" }
```

Expected: generator exits 0, `git diff --exit-code` exits 0, and the explicit count is 1.

- [ ] **Step 3: Run the focused test set from freshly compiled code**

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js build/tests/unit/tools/page/detectCaptcha.test.js
```

Expected: all CAPTCHA module and tool subtests pass with zero failures.

- [ ] **Step 4: Enforce at least 80% coverage for the new module and adapter**

Run:

```powershell
npx --no-install c8 --all --reporter=text --include="build/src/modules/captcha/**/*.js" --include="build/src/tools/page/detectCaptcha.js" --check-coverage --lines=80 --functions=80 --branches=80 --statements=80 node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js build/tests/unit/tools/page/detectCaptcha.test.js
```

Expected: command exits 0 and each enforced aggregate metric is at least 80%. If it fails, use the emitted uncovered-line table to add only one of these already-approved missing behaviors to the owning test:

- rule aggregation: generic DOM, exclusion conflict, strong-DOM precedence, evidence limit, or kind priority;
- snapshot acquisition: each visibility predicate, missing body, field limit, or critical-read rejection;
- waiting: initial clear, clear-streak reset, budget result, no-success budget failure, transient retry/reset, or timer cleanup;
- tool adapter: missing page, both actions, detect-only timeout no-op behavior, or one of the fixed safe-error mappings.

Do not add a production branch merely to increase coverage and do not expose a private helper.

- [ ] **Step 5: Run the scoped security and clean-room checks**

Run:

```powershell
$forbiddenCalls = rg -n -i "page\.(click|dragAndDrop|fill|type|screenshot)\s*\(|locator\([^)]*\)\.(click|dragTo|fill|type)\s*\(|dispatchEvent\s*\(|\.setAttribute\s*\(|\.removeAttribute\s*\(|setInterval\s*\(|addEventListener\s*\(|RuntimeServices|StealthScripts|localStorage|sessionStorage|document\.cookie|fetch\s*\(|XMLHttpRequest|WebSocket" src/modules/captcha src/tools/page/detectCaptcha.ts
if ($LASTEXITCODE -eq 0) { $forbiddenCalls; throw 'Forbidden mutation or runtime coupling found' }
if ($LASTEXITCODE -ne 1) { throw 'Forbidden-call scan failed' }

$vendorNames = rg -n -i "recaptcha|hcaptcha|turnstile|geetest|cloudflare" src/modules/captcha src/tools/page/detectCaptcha.ts
if ($LASTEXITCODE -eq 0) { $vendorNames; throw 'Provider-specific production rule found' }
if ($LASTEXITCODE -ne 1) { throw 'Vendor-name scan failed' }

$siteKeyReads = rg -n "getAttribute\(['""]data-sitekey['""]\)" src/modules/captcha src/tools/page/detectCaptcha.ts
if ($LASTEXITCODE -eq 0) { $siteKeyReads; throw 'Site-key value read found' }
if ($LASTEXITCODE -ne 1) { throw 'Site-key scan failed' }

npm audit --audit-level=high
```

Expected: all three `rg` scans find nothing. Record `npm audit`'s exit code and findings separately; because this feature changes neither dependency file, any pre-existing audit finding is a reported repository baseline, not authority to update packages.

- [ ] **Step 6: Run the repository-required final gates**

Run in this order:

```powershell
npm run typecheck
npm run test:unit
npm run check-format
```

Expected: all three commands exit 0 after the final relevant source/test change. A pass from before a repair does not count.

- [ ] **Step 7: Inspect the final diff against the approved exclusions**

Run:

```powershell
$implementationBase = git merge-base HEAD refactor
git diff --check $implementationBase..HEAD
git diff --stat $implementationBase..HEAD
git diff $implementationBase..HEAD -- src/modules/captcha src/tools/page/detectCaptcha.ts src/tools/page/manifest.ts src/tools/page/index.ts src/tools/generated-tools-index.ts tests/unit/modules/captcha tests/unit/tools/page/detectCaptcha.test.ts
```

Check every changed line against this fixed list:

- assessment is passive and performs one bounded `evaluate`;
- strong DOM and independent-source aggregation match the confidence table;
- OTP/account exclusions cannot defeat strong DOM;
- evidence is fixed-summary, deduplicated, ordered, and capped;
- waiting counts attempts, requires stable clearance, caps transient retries, and returns no fake negative;
- tool `success` means execution success, not “no CAPTCHA”;
- no AI, automatic solution, mutation, screenshot, network, persistence, injection, eager CDP, browser lifecycle, or provider-specific code exists;
- only generator-owned output changed in `generated-tools-index.ts`.

- [ ] **Step 8: Apply the review boundary correctly**

If the user explicitly authorized subagents by selecting the subagent-driven execution option, use `requesting-code-review` with:

```text
DESCRIPTION: Clean-room passive CAPTCHA assessment, stable-clear waiting, and one read-only page MCP tool.
PLAN_OR_REQUIREMENTS: docs/superpowers/specs/2026-08-13-captcha-passive-detection-design.md and this plan.
BASE_SHA: output of git merge-base HEAD refactor
HEAD_SHA: output of git rev-parse HEAD
```

Fix every Critical or Important finding that is valid and inside scope. If the user did not authorize delegation, do not dispatch a reviewer; perform Step 7 locally and report “independent subagent review not run: delegation not authorized.”

For any code/test repair from coverage, gates, or review:

```powershell
npx --no-install prettier --write src/modules/captcha/types.ts src/modules/captcha/rules.ts src/modules/captcha/CaptchaDetector.ts src/modules/captcha/index.ts src/tools/page/detectCaptcha.ts src/tools/page/manifest.ts src/tools/page/index.ts tests/unit/modules/captcha/CaptchaRules.test.ts tests/unit/modules/captcha/CaptchaDetector.test.ts tests/unit/tools/page/detectCaptcha.test.ts
npm run build:index
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/captcha/CaptchaRules.test.js build/tests/unit/modules/captcha/CaptchaDetector.test.js build/tests/unit/tools/page/detectCaptcha.test.js
npm run typecheck
npm run test:unit
npm run check-format
git add -- src/modules/captcha/types.ts src/modules/captcha/rules.ts src/modules/captcha/CaptchaDetector.ts src/modules/captcha/index.ts src/tools/page/detectCaptcha.ts src/tools/page/manifest.ts src/tools/page/index.ts src/tools/generated-tools-index.ts tests/unit/modules/captcha/CaptchaRules.test.ts tests/unit/modules/captcha/CaptchaDetector.test.ts tests/unit/tools/page/detectCaptcha.test.ts
git diff --cached --check
git commit -m "fix(captcha): address final verification findings"
```

If no repair occurs, do not run this block and do not create an empty commit. After a repair, repeat Steps 2–7 so every final claim has post-repair evidence.

- [ ] **Step 9: Produce the close-code-change handoff**

Use `close-code-change` and report:

- each of the eleven changed files grouped by rules, detector, tool registration, and tests;
- focused test, coverage, generated index, forbidden scans, `npm audit`, `typecheck`, full `test:unit`, and `check-format` as `passed`, `failed`, or `not run`;
- every failure → scoped repair → fresh rerun link;
- any pre-existing audit issue or unverified external/browser boundary;
- `git status --short`, which must be empty before claiming completion.

Do not push, open a PR, merge, delete the worktree, or alter the original dirty checkout.

- [ ] **Step 10: Run the non-trivial-task self-evaluation**

Use `agent-self-evaluation` and score accuracy, completeness, clarity, actionability, and conciseness from 1–5 with evidence from Steps 2–9. Include the arithmetic mean to one decimal place and one to three ranked improvements. If any axis is 3 or below, make the quick fix when it stays in scope, then rerun every invalidated check before the final handoff.

---

## Completion Criteria

The implementation is complete only when all of the following are evidenced from the final diff:

- passive `assess` and stable `waitForClear` behavior match the approved state and confidence tables;
- `detect_captcha` is read-only, explicit, registered exactly once, and returns the approved response shapes;
- privacy bounds and clean-room/license boundaries hold;
- new-module/adapter coverage is at least 80% for lines, functions, branches, and statements;
- focused tests, `npm run typecheck`, `npm run test:unit`, and `npm run check-format` pass after the last change;
- the generated index is reproducible;
- no task-owned blocker remains and no unrelated dirty-worktree content entered the branch.
