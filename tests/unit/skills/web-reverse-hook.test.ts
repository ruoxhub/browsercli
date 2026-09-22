/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import {describe, it} from 'node:test';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

/**
 * 技能脚本在仓库根目录的 skills/ 下，不参与 TS 编译，所以用 cwd 拼绝对路径
 * 再动态 import（源码与 build 产物下 cwd 都是仓库根）。
 */
const repoRoot = process.cwd();

async function loadSkillModule(relativePath: string) {
  return (await import(
    pathToFileURL(path.join(repoRoot, relativePath)).href
  )) as Record<string, unknown>;
}

interface LogEntry {
  type?: string;
  key?: string;
  name?: string;
  value?: unknown;
}

type HookBuilder = (
  preset: string,
  options?: Record<string, unknown>,
) => {
  hookId: string;
  description: string;
  script: string;
};

async function loadBuildHook(): Promise<{
  buildHookScript: HookBuilder;
}> {
  const mod = await loadSkillModule(
    'skills/web-reverse-hook/scripts/build-hook.js',
  );
  return mod as unknown as {buildHookScript: HookBuilder};
}

async function loadCompareEnv(): Promise<{
  buildCompareEnvExpression: (properties?: string[]) => string;
}> {
  const mod = await loadSkillModule(
    'skills/web-reverse-env/scripts/compare-env.js',
  );
  return mod as unknown as {
    buildCompareEnvExpression: (properties?: string[]) => string;
  };
}

function createRealm(extraGlobals = ''): vm.Context {
  const realm = vm.createContext({});
  vm.runInContext(
    `
class Navigator {
  #userAgent = 'BrowserCLI/1.0';
  get userAgent() { return this.#userAgent; }
  get platform() { return 'TestOS'; }
}
class Screen { get width() { return 1920; } }
class History {
  #scrollRestoration = 'auto';
  get length() { return 1; }
  get scrollRestoration() { return this.#scrollRestoration; }
  set scrollRestoration(value) { this.#scrollRestoration = value; }
}
class Performance {
  get timeOrigin() { return 1; }
  now() { return 2; }
}
class Location { get href() { return 'https://example.com/'; } }
class Document { get visibilityState() { return 'visible'; } }
class HTMLDocument extends Document {}

globalThis.__capturedLogs = [];
globalThis.console = {
  log: function () { globalThis.__capturedLogs.push(Array.prototype.slice.call(arguments)); },
  warn: function () {},
  group: function () {},
  groupEnd: function () {},
};
globalThis.window = globalThis;
globalThis.navigator = new Navigator();
globalThis.screen = new Screen();
globalThis.history = new History();
globalThis.performance = new Performance();
globalThis.location = new Location();
globalThis.document = new HTMLDocument();
globalThis.localStorage = {kind: 'local'};
globalThis.sessionStorage = {kind: 'session'};
globalThis.devicePixelRatio = 1.5;
globalThis.customObject = {ok: true};
globalThis.__originalNavigator = globalThis.navigator;
globalThis.__originalCall = Function.prototype.call;
globalThis.__originalReflectGet = Reflect.get;
${extraGlobals}
`,
    realm,
  );
  return realm;
}

function runScript(realm: vm.Context, script: string): unknown {
  return vm.runInContext(script, realm);
}

function jsvmpLog(realm: vm.Context): LogEntry[] {
  return JSON.parse(
    vm.runInContext(
      'JSON.stringify(window.__mcp_jsvmp_log || [])',
      realm,
    ) as string,
  ) as LogEntry[];
}

function capturedLogs(realm: vm.Context): unknown[][] {
  return vm.runInContext('globalThis.__capturedLogs', realm) as unknown[][];
}

function loggedText(realm: vm.Context): string {
  return capturedLogs(realm)
    .map(args => args.map(arg => String(arg)).join(' '))
    .join('\n');
}

describe('web-reverse-hook: JSVMP proxy 探针', () => {
  it('记录被品牌校验的属性读取且不改变语义', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    runScript(
      realm,
      buildHookScript('jsvmp-proxy', {
        maxEntries: 1,
        trackCalls: false,
        trackProps: true,
        trackReflect: false,
        proxyObjects: ['navigator'],
      }).script,
    );

    runScript(realm, 'navigator.userAgent; navigator.platform;');

    assert.deepEqual(
      jsvmpLog(realm).map(entry => entry.type),
      ['proxy_get'],
    );
    assert.equal(jsvmpLog(realm)[0].key, 'userAgent');
    assert.equal(jsvmpLog(realm)[0].value, 'BrowserCLI/1.0');
  });

  it('记录 Function.prototype.call 调用', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    runScript(
      realm,
      buildHookScript('jsvmp-proxy', {
        maxEntries: 10,
        trackCalls: true,
        trackProps: false,
        trackReflect: false,
        proxyObjects: [],
      }).script,
    );

    const value = runScript(
      realm,
      '(function add(a, b) { return a + b; }).call(null, 2, 3)',
    );

    assert.equal(value, 5);
    assert.ok(
      jsvmpLog(realm).some(
        entry => entry.type === 'fn_call' && entry.name === 'add',
      ),
    );
  });

  it('安装自身的开销不占用日志配额', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    runScript(
      realm,
      buildHookScript('jsvmp-proxy', {
        maxEntries: 1,
        trackCalls: true,
        trackProps: true,
        trackReflect: true,
        proxyObjects: ['navigator', 'performance'],
      }).script,
    );

    assert.deepEqual(jsvmpLog(realm), []);
    runScript(realm, 'navigator.userAgent');
    assert.deepEqual(
      jsvmpLog(realm).map(entry => entry.type),
      ['proxy_get'],
    );
  });

  it('记录属性写入且不改变语义', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    runScript(
      realm,
      buildHookScript('jsvmp-proxy', {
        maxEntries: 10,
        trackCalls: false,
        trackProps: true,
        trackReflect: false,
        proxyObjects: ['history'],
      }).script,
    );

    const value = runScript(
      realm,
      "history.scrollRestoration = 'manual'; history.scrollRestoration",
    );

    assert.equal(value, 'manual');
    assert.ok(
      jsvmpLog(realm).some(
        entry =>
          entry.type === 'proxy_set' && entry.key === 'scrollRestoration',
      ),
    );
  });

  it('卸载时恢复所有被替换的内建对象与全局对象', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    runScript(
      realm,
      buildHookScript('jsvmp-proxy', {
        maxEntries: 10,
        trackCalls: true,
        trackProps: true,
        trackReflect: true,
        proxyObjects: ['navigator'],
      }).script,
    );

    assert.equal(
      runScript(
        realm,
        `
window.__mcp_jsvmp_uninstall();
navigator === window.__originalNavigator &&
  Function.prototype.call === window.__originalCall &&
  Reflect.get === window.__originalReflectGet &&
  window.__mcp_jsvmp_installed === false;
`,
      ),
      true,
    );
  });

  it('追踪开关关闭后不再记录调用', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    runScript(
      realm,
      buildHookScript('jsvmp-proxy', {trackCalls: false}).script,
    );
    runScript(realm, '(function add(a, b) { return a + b; }).call(null, 1, 2)');

    assert.ok(!jsvmpLog(realm).some(entry => entry.type === 'fn_call'));
  });
});

describe('web-reverse-hook: JSVMP transparent 探针', () => {
  it('不构造 Proxy 也能记录原型 getter 读取', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm(
      `globalThis.Proxy = function ForbiddenProxy() {
        throw new Error('Proxy construction is forbidden');
      };`,
    );
    runScript(
      realm,
      buildHookScript('jsvmp-transparent', {maxEntries: 10}).script,
    );

    assert.equal(runScript(realm, 'navigator.userAgent'), 'BrowserCLI/1.0');
    assert.ok(
      jsvmpLog(realm).some(
        entry => entry.type === 'transparent_get' && entry.key === 'userAgent',
      ),
    );
  });
});

describe('web-reverse-hook: 加密库预设', () => {
  it('cryptojs 预设包装 Function.prototype.apply 并输出算法配置', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm();
    const originalApply = runScript(realm, 'Function.prototype.apply');
    const {script, hookId} = buildHookScript('cryptojs', {
      algorithms: ['AES', 'SHA'],
      logFormat: 'json',
    });

    assert.equal(hookId, 'hook_cryptojs');
    assert.ok(script.includes('"AES","SHA"'));
    runScript(realm, script);

    assert.notEqual(
      runScript(realm, 'Function.prototype.apply'),
      originalApply,
    );
    assert.match(loggedText(realm), /hook_cryptojs/);
  });

  it('jsencrypt 预设拦截 RSA 加解密并保留原返回值', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm(`
globalThis.JSEncrypt = function JSEncrypt() {};
globalThis.JSEncrypt.prototype.encrypt = function (plaintext) {
  return 'cipher:' + plaintext;
};
globalThis.JSEncrypt.prototype.decrypt = function (ciphertext) {
  return 'plain:' + ciphertext;
};
`);
    runScript(realm, buildHookScript('jsencrypt', {logFormat: 'json'}).script);

    assert.equal(
      runScript(realm, 'new window.JSEncrypt().encrypt("hello")'),
      'cipher:hello',
    );
    assert.equal(
      runScript(realm, 'new window.JSEncrypt().decrypt("abc")'),
      'plain:abc',
    );
    assert.match(loggedText(realm), /"type":"encrypt"/);
    assert.match(loggedText(realm), /"type":"decrypt"/);
  });

  // sm-crypto 的 UMD 产物整体挂在 window.sm2 上（其内部才是 {sm2, sm3, sm4}），
  // 所以探针用 `window.sm2 || window.sm3 || window.sm4` 取到的是这个容器。
  const SM_CRYPTO_CONTAINER = `
globalThis.sm2 = {
  sm2: {
    encrypt: function (data) { return 'sm2:' + data; },
    decrypt: function (cipher) { return 'sm2:' + cipher; },
  },
  sm3: function (data) { return 'sm3:' + data; },
  sm4: {encrypt: function (data, key) { return 'sm4:' + data + key; }},
};
`;

  it('smcrypto 预设按请求的算法集合选择包装目标', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm(SM_CRYPTO_CONTAINER);
    const originalEncrypt = runScript(realm, 'globalThis.sm2.sm2.encrypt');
    runScript(
      realm,
      buildHookScript('smcrypto', {
        algorithms: ['SM2'],
        logFormat: 'json',
      }).script,
    );

    assert.equal(
      runScript(realm, 'globalThis.sm2.sm2.encrypt("abc")'),
      'sm2:abc',
    );
    assert.notEqual(
      runScript(realm, 'globalThis.sm2.sm2.encrypt'),
      originalEncrypt,
    );
    assert.match(loggedText(realm), /"algorithm":"SM2"/);
    assert.match(loggedText(realm), /"type":"encrypt"/);
  });

  it('smcrypto 预设未请求的算法保持原始实现', async () => {
    const {buildHookScript} = await loadBuildHook();
    const realm = createRealm(SM_CRYPTO_CONTAINER);
    const originalEncrypt = runScript(realm, 'globalThis.sm2.sm2.encrypt');
    runScript(
      realm,
      buildHookScript('smcrypto', {
        algorithms: ['SM3'],
        logFormat: 'json',
      }).script,
    );

    // SM2 未请求：保持原始实现，不产生 SM2 记录
    assert.equal(
      runScript(realm, 'globalThis.sm2.sm2.encrypt("abc")'),
      'sm2:abc',
    );
    assert.equal(
      runScript(realm, 'globalThis.sm2.sm2.encrypt'),
      originalEncrypt,
    );
    assert.ok(!loggedText(realm).includes('"algorithm":"SM2"'));

    // SM3 请求：包装并记录
    assert.equal(runScript(realm, 'globalThis.sm2.sm3("abc")'), 'sm3:abc');
    assert.match(loggedText(realm), /"algorithm":"SM3"/);
  });
});

describe('web-reverse-hook: 生成脚本的注入契约', () => {
  /**
   * evaluate_script 会把 function 参数整体包进括号再求值（`((<脚本>))`），
   * 因此脚本必须是**表达式**且结尾无分号——多一个分号就是 `(...;)`，
   * 页面侧直接 SyntaxError。这条契约靠 build-hook 与 evaluate_script 两侧共同维持，
   * 回归时最容易踩。
   */
  it('生成的脚本是合法表达式，且可被 evaluate_script 的包装形式求值', async () => {
    const {buildHookScript} = await loadBuildHook();
    for (const preset of [
      'cryptojs',
      'jsencrypt',
      'smcrypto',
      'jsvmp-proxy',
      'jsvmp-transparent',
    ]) {
      const {script} = buildHookScript(preset);
      assert.ok(
        !script.trimEnd().endsWith(';'),
        `${preset}: 生成脚本结尾不能有分号`,
      );
      assert.doesNotThrow(
        () => new Function(`return (${script})`),
        `${preset}: 生成脚本不是合法表达式`,
      );
      assert.doesNotThrow(
        () =>
          new Function(
            `return (async () => { const value = await (${script}); ` +
              `return JSON.stringify(typeof value === 'function' ? await value() : value); })()`,
          ),
        `${preset}: evaluate_script 的包装形式求值失败`,
      );
    }
  });

  /**
   * --json 的输出直接喂给 `inject_hook --stdin`，字段名必须与它的 schema 一致。
   * 多带字段（例如 description）会被参数校验拒绝，所以这里锁死字段集合。
   */
  it('--json 只输出 inject_hook 认识的字段', async () => {
    const {execFile} = await import('node:child_process');
    const {promisify} = await import('node:util');
    const execFileAsync = promisify(execFile);
    const scriptPath = path.join(
      repoRoot,
      'skills/web-reverse-hook/scripts/build-hook.js',
    );

    const {stdout} = await execFileAsync(process.execPath, [
      scriptPath,
      'cryptojs',
      '--json',
    ]);
    const payload = JSON.parse(stdout) as Record<string, unknown>;

    assert.deepEqual(Object.keys(payload).sort(), ['hookId', 'script']);
    assert.equal(payload.hookId, 'hook_cryptojs');
    assert.equal(typeof payload.script, 'string');
  });
});

describe('web-reverse-env: compare-env 采集脚本', () => {
  it('采集标准字段与请求的属性路径，并保留失败原因', async () => {
    const {buildCompareEnvExpression} = await loadCompareEnv();
    const realm = createRealm();
    const expression = buildCompareEnvExpression([
      'navigator.userAgent',
      'window.customObject',
      'missing.value',
    ]);

    const data = runScript(realm, `(${expression})()`) as Record<
      string,
      Record<string, {value: unknown; type?: string; error?: string}>
    >;

    assert.equal(data.navigator.userAgent.value, 'BrowserCLI/1.0');
    assert.equal(data.screen.width.value, 1920);
    assert.equal(data.screen.devicePixelRatio.value, 1.5);
    assert.equal(data.timing.timezone.type, 'string');
    assert.deepEqual(Object.keys(data.canvas), []);
    assert.equal(data.custom['window.customObject'].value, '{"ok":true}');
    assert.match(
      data.custom['missing.value'].error ?? '',
      /missing is not defined/,
    );
  });

  it('拒绝非点分隔路径，避免采集脚本变成任意表达式执行入口', async () => {
    const {buildCompareEnvExpression} = await loadCompareEnv();
    const realm = createRealm();
    const expression = buildCompareEnvExpression([
      'navigator.userAgent; process',
    ]);

    const data = runScript(realm, `(${expression})()`) as Record<
      string,
      Record<string, {error?: string}>
    >;

    assert.match(
      data.custom['navigator.userAgent; process'].error ?? '',
      /Only dot-separated property paths/,
    );
  });
});
