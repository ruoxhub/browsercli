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
