import assert from 'node:assert';
import {describe, it} from 'node:test';

import {detectAntiDebugPatterns} from '../../../../src/modules/analyzer/PatternDetector.js';

import type {AnalyzerConsoleMessage} from '../../../../src/modules/analyzer/IntelligentAnalyzer.types.js';

function log(text: string, url?: string): AnalyzerConsoleMessage {
  return {type: 'log', text, url};
}

describe('detectAntiDebugPatterns', () => {
  it('detects a plain debugger statement', () => {
    const patterns = detectAntiDebugPatterns([log('function() { debugger; }')]);
    assert.deepStrictEqual(
      patterns.map(p => p.type),
      ['debugger'],
    );
    assert.strictEqual(patterns[0].location, 'unknown');
  });

  it('reports the console location when available and truncates code to 200 chars', () => {
    const url = 'https://example.com/app.js';
    const long = `debugger; ${'x'.repeat(300)}`;
    const patterns = detectAntiDebugPatterns([log(long, url)]);
    assert.strictEqual(patterns.length, 1);
    assert.strictEqual(patterns[0].location, url);
    assert.strictEqual(patterns[0].code.length, 200);
  });

  it('detects console.log content only when it contains an assignment', () => {
    const patterns = detectAntiDebugPatterns([
      log('console.log("no equals sign here")'),
      log('console.log(x) = 42'),
    ]);
    const kinds = patterns.map(p => p.type);
    assert.ok(kinds.includes('console.log'));
    assert.strictEqual(kinds.filter(k => k === 'console.log').length, 1);
  });

  it('detects devtools and firebug keywords as devtools-detect', () => {
    const patterns = detectAntiDebugPatterns([
      log('if (window.devtools) { alert("bot") }'),
      log('firebug alive'),
    ]);
    const kinds = patterns.map(p => p.type);
    assert.strictEqual(kinds.filter(k => k === 'devtools-detect').length, 2);
  });

  it('detects timing-based checks', () => {
    const patterns = detectAntiDebugPatterns([
      log('performance.now() - start > 1000'),
      log('Date.now() - last < 200'),
    ]);
    const kinds = patterns.map(p => p.type);
    assert.strictEqual(kinds.filter(k => k === 'timing-check').length, 2);
  });

  it('returns empty array for logs without anti-debug markers', () => {
    assert.deepStrictEqual(detectAntiDebugPatterns([log('hello world')]), []);
  });

  it('can emit multiple pattern kinds for one log line', () => {
    const patterns = detectAntiDebugPatterns([
      log('debugger; console.log(x)=1'),
    ]);
    const kinds = patterns.map(p => p.type);
    assert.ok(kinds.includes('debugger'));
    assert.ok(kinds.includes('console.log'));
  });
});
