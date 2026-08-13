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
