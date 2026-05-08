#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SAMPLES = {
  obfuscated: `var _0x1a2b = ['log', 'Hello', 'encrypt', 'AES'];
(function(_0x3c4d5e, _0x1a2b3c) {
  var _0x4d5e6f = function(_0x5f6g7h) {
    while (--_0x5f6g7h) { _0x3c4d5e.push(_0x3c4d5e.shift()); }
  };
  _0x4d5e6f(++_0x1a2b3c);
})(_0x1a2b, 0x1a2);
function generateSign(params, key) {
  var sorted = Object.keys(params).sort().map(function(k) { return k + '=' + params[k]; }).join('&');
  return CryptoJS.HmacMD5(sorted, key).toString();
}`,
  clean: `function add(a, b) { return a + b; }
function formatDate(date) { return date.toISOString().split('T')[0]; }
console.log(add(1, 2));`,
  hexEncoded: String.raw`var _0x5c1a = function() {
  var _0x2f8b = ['\x6c\x6f\x67', '\x48\x65\x6c\x6c\x6f'];
  _0x5c1a = function() { return _0x2f8b; };
  return _0x5c1a();
};
var _0xabc = _0x5c1a();
console[_0xabc[0]](_0xabc[1]);`,
  cflatten: `var _0x3d8f = ['foo', 'bar', 'baz'];
var _0x4e9g = '0|1|2'.split('|'), _0x5f0h = 0;
while (true) {
  switch (_0x4e9g[_0x5f0h++]) {
    case '0': _0x3d8f.push('qux'); continue;
    case '1': _0x3d8f.push('quux'); continue;
    case '2': return _0x3d8f;
  }
  break;
}`
};

function parseArgs(argv) {
  const a = { rpcHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 30000 };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rpcHost': a.rpcHost = argv[++i]; break;
      case '--group': a.group = argv[++i]; break;
      case '--timeout': a.timeout = Number(argv[++i]); break;
    }
  }
  return a;
}

function toHttpUrl(ws) { return ws.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, ''); }

async function invoke(httpUrl, group, tool, params, timeout) {
  const url = httpUrl + '/business/invoke';
  const body = { group, action: tool, ...(Object.keys(params).length ? { params } : {}) };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) return { ok: false, status: 'http_error', httpStatus: r.status, error: await r.text().catch(() => '') };
    const j = await r.json();
    if (j.status === -1 || j.code === -1) return { ok: false, status: 'rpc_error', error: j.message || 'Sekiro action failed', data: null };
    // Fix: Extract data from Sekiro's structuredContent wrapper
    const structuredContent = j.structuredContent;
    if (structuredContent && structuredContent.data) {
      return { ok: true, status: 'ok', data: structuredContent.data };
    }
    return { ok: true, status: 'ok', data: j.data ?? j };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, status: 'timeout', error: 'Timeout (' + timeout + 'ms)' };
    return { ok: false, status: 'network_error', error: e.message };
  } finally { clearTimeout(t); }
}

function validateStruct(data) {
  const issues = [];
  if (!data) return { valid: false, issues: ['data is null/undefined'] };
  if (typeof data.code !== 'string') issues.push('code: missing/wrong type (' + typeof data.code + ')');
  else if (!data.code.length) issues.push('code: empty string');
  if (typeof data.readabilityScore !== 'number') issues.push('readabilityScore: missing/wrong type');
  else if (data.readabilityScore < 0 || data.readabilityScore > 100) issues.push('readabilityScore: out of range ' + data.readabilityScore);
  if (typeof data.confidence !== 'number') issues.push('confidence: missing/wrong type');
  else if (data.confidence < 0 || data.confidence > 1) issues.push('confidence: out of range ' + data.confidence);
  if (!Array.isArray(data.obfuscationType)) issues.push('obfuscationType: missing/not array');
  if (!Array.isArray(data.transformations)) issues.push('transformations: missing/not array');
  if (typeof data.analysis !== 'string') issues.push('analysis: missing/wrong type');
  if (Array.isArray(data.transformations)) {
    for (let i = 0; i < data.transformations.length; i++) {
      const t = data.transformations[i];
      if (!t || typeof t !== 'object') { issues.push('transformations[' + i + ']: not object'); continue; }
      if (typeof t.type !== 'string') issues.push('transformations[' + i + '].type: missing');
      if (typeof t.description !== 'string') issues.push('transformations[' + i + '].description: missing');
      if (typeof t.success !== 'boolean') issues.push('transformations[' + i + '].success: missing');
    }
  }
  return { valid: !issues.length, issues };
}

function validateQuality(data, original) {
  const c = {};
  c.nonEmpty = typeof data.code === 'string' && data.code.length > 0;
  c.differsFromInput = c.nonEmpty && data.code !== original;
  const hexIn = /\x[0-9a-fA-F]{2}/.test(original);
  c.hexDecoded = !hexIn || !/\x[0-9a-fA-F]{2}/.test(data.code);
  const obfVars = /_0x[0-9a-fA-F]+/.test(original);
  c.varsRenamed = !obfVars || !/_0x[0-9a-fA-F]+/.test(data.code);
  const strRot = /\.push\(.*\.shift\(\)\)/.test(original);
  c.strArrayResolved = !strRot || !/\.push\(.*\.shift\(\)\)/.test(data.code);
  c.hasSuccessTransform = Array.isArray(data.transformations) && data.transformations.some(t => t.success);
  c.readabilityOk = typeof data.readabilityScore === 'number' && data.readabilityScore >= 0 && data.readabilityScore <= 100;
  c.confidenceOk = typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 1;
  const passed = Object.values(c).filter(Boolean).length;
  const total = Object.keys(c).length;
  return { valid: passed >= Math.ceil(total * 0.6), checks: c, passed, total };
}

function printChecks(checks, indent) {
  indent = indent || '  ';
  const labels = { nonEmpty: 'output non-empty', differsFromInput: 'differs from input', hexDecoded: 'hex decoded', varsRenamed: 'vars renamed', strArrayResolved: 'string array resolved', hasSuccessTransform: 'has success transform', readabilityOk: 'readabilityScore ok', confidenceOk: 'confidence ok' };
  for (const [k, v] of Object.entries(labels)) console.log(indent + (checks[k] ? '✓' : '✗') + ' ' + v);
}

function printDetails(data) {
  console.log('  -- Structure --');
  console.log('    code:            ' + (data.code ? data.code.length : 0) + ' chars');
  console.log('    readabilityScore: ' + (data.readabilityScore ?? '(missing)'));
  console.log('    confidence:       ' + (data.confidence ?? '(missing)'));
  console.log('    obfuscationType:  [' + ((data.obfuscationType || []).join(', ') || '(empty)') + ']');
  console.log('    transformations:  ' + (data.transformations ? data.transformations.length : 0) + ' items');
  if (data.transformations && data.transformations.length) {
    for (const t of data.transformations.slice(0, 5)) console.log('      - ' + t.type + ': ' + (t.description || '').slice(0, 60) + ' [' + (t.success ? '✓' : '✗') + ']');
    if (data.transformations.length > 5) console.log('      ... ' + (data.transformations.length - 5) + ' more');
  }
  console.log('    analysis:         ' + ((data.analysis || '').slice(0, 80)) + '...');
}

function preview(code, n) { n = n || 200; if (!code) return; const p = code.slice(0, n).replace(/\n/g, '\\n'); console.log('  -- Preview --\n    ' + p + (code.length > n ? '...' : '')); }

async function runTest(label, code, opts, httpUrl, group, timeout, doQuality) {
  console.log('\n-- ' + label + ' --');
  const start = Date.now();
  const r = await invoke(httpUrl, group, 'deobfuscate_code', { code, ...opts }, timeout);
  const dur = Date.now() - start;
  if (!r.ok) { console.log('  ✗ FAIL (' + dur + 'ms) [' + r.status + '] ' + (r.error || '').slice(0, 80)); return { name: label, ok: false, valid: false }; }
  const s = validateStruct(r.data);
  const q = doQuality ? validateQuality(r.data, code) : null;
  console.log('  ' + (s.valid ? '✓' : '⚠') + ' OK (' + dur + 'ms)');
  console.log(r.data)
  printDetails(r.data);
  if (s.issues.length) { console.log('  ⚠ Issues:'); for (const i of s.issues) console.log('    - ' + i); }
  if (q) { console.log('  -- Quality (' + q.passed + '/' + q.total + ') --'); printChecks(q.checks); preview(r.data.code); }
  return { name: label, ok: true, valid: s.valid && (!q || q.valid) };
}

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);
  console.log('\n🔍 deobfuscate_code Verification');
  console.log('   Sekiro: ' + httpUrl + '  Group: ' + args.group + '  Timeout: ' + args.timeout + 'ms\n');
  console.log('⏳ Checking Sekiro Server...');
  try { const r = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) }); if (!r.ok && r.status !== 302) throw new Error('HTTP ' + r.status); }
  catch { console.error('❌ Sekiro Server unavailable: ' + httpUrl); process.exit(1); }
  console.log('✓ Sekiro Server available\n');

  const results = [];
  results.push(await runTest('Test 1: Basic Obfuscation (aggressive, renameVars)', SAMPLES.obfuscated, { aggressive: true, renameVariables: true }, httpUrl, args.group, args.timeout, true));
  results.push(await runTest('Test 2: Non-aggressive Mode', SAMPLES.obfuscated, { aggressive: false }, httpUrl, args.group, args.timeout, false));
  results.push(await runTest('Test 3: Clean Code (no obfuscation)', SAMPLES.clean, { aggressive: true, renameVariables: true }, httpUrl, args.group, args.timeout, false));
  results.push(await runTest('Test 4: Hex-encoded Obfuscation', SAMPLES.hexEncoded, { aggressive: true, renameVariables: true }, httpUrl, args.group, args.timeout, true));
  results.push(await runTest('Test 5: Control Flow Flattening', SAMPLES.cflatten, { aggressive: true, renameVariables: true }, httpUrl, args.group, args.timeout, false));
  results.push(await runTest('Test 6: Empty Code (edge case)', '', {}, httpUrl, args.group, args.timeout, false));

  console.log('\n── Summary ──────────────────────────────────────────────');
  for (const r of results) { const m = r.valid ? '✓' : r.ok ? '⚠' : '✗'; console.log('  ' + m + ' ' + r.name); }

  const passed = results.filter(r => r.valid).length;
  const total = results.length;
  const ok = passed >= Math.ceil(total * 0.5);
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Result: ' + (ok ? '✓ PASS' : '✗ FAIL') + '  (' + passed + '/' + total + ' tests valid)');
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(2); });
