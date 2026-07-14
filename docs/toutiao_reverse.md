---
title: '【完整记录】AI自动逆向补头条环境和采集数据'
source: 'https://mp.weixin.qq.com/s/M5KSXC2mvWCEAOW5SEYRmg'
author:
  - '[[编程如意]]'
published:
created: 2026-04-27
description: '用claude code opus 4.6搞个jsvmp也就二十几块，某数、某验、某条直接给个指令就去逆向了，JS逆向基本也快到头了。'
tags:
  - 'clippings'
---

原创 编程如意 _2026年4月26日 21:45_

> 分析日期：2026-04-21 分析目标： `https://www.toutiao.com/article/7630793912500437540/` API接口： `https://www.toutiao.com/article/v4/tab_comments/` 关键JS文件： `tt_pc_bricks.ec0a9f54.js` 、 `acrawler.js`

---

## 第一阶段：网络抓包与入口定位

### 1.1 打开目标页面捕获请求

在浏览器中打开 `https://www.toutiao.com/article/7630793912500437540/` ，使用 DevTools 抓取 XHR/Fetch 请求。

**捕获到的带 `_signature` 的关键请求：**

```apache
reqid=60 GET /api/pc/info?_signature=_02B4Z6wo00f01dBlsCAAAIDAqoxExnwDEN3QQZSAAB4Bi...reqid=62 GET /article/v4/tab_comments/?aid=24&app_name=toutiao_web&offset=0&count=20&group_id=7630793912500437540&item_id=7630793912500437540&_signature=_02B4Z6wo00f01dBlsCAAAIDAqoxExnwALR3QQZSAAB4BY5bs5El8...reqid=64 GET /hot-event/hot-board/?origin=toutiao_pc&_signature=_02B4Z6wo00f01dBlsCAAAIDAqoxExnwAAmXQQZSAAB4BjRDUV9...
```

### 1.2 定位签名生成入口

用户提供的关键代码在 `tt_pc_bricks.ec0a9f54.js` 中的 axios 拦截器：

```javascript
Z.interceptors.request.use(function (e) {
  var t;
  if (
    !(function (e) {
      return (
        !e ||
        !P()(D).call(D, function (t) {
          return M()(e).call(e, t) > -1;
        })
      );
    })(e.url)
  )
    return e;
  (null === (t = e.params) || void 0 === t ? void 0 : t._signature) &&
    delete e.params._signature;
  var n = U(Z.getUri(e), e);
  return ((e.params = j()(j()({}, e.params), {_signature: n})), e);
});
```

通过 WebFetch 获取完整 JS 文件（358,904 字节），搜索拦截器位置（偏移 179,218）。

### 1.3 定位函数 U 的定义

从拦截器所在模块 `4ebcd730fa76886c6ad9` （偏移 170,690）提取 import 声明，发现签名函数 U 不是外部导入，而是 **模块内部定义** ：

```javascript
// 偏移 170690 处的模块var D = ["/tt-anti-token", "/video/urls/v/1/toutiao/mp4/"];  // 不需要签名的URLvar F = ["/hot-event/hot-board/", "/api/pc/user/follow", "/browser/2/"];  // 不加 /toutiao 前缀的URLfunction U(e, t) {    var n, r, a;    var o = "".concat(location.protocol, "//").concat(location.host);    (function(e) {        return !P()(F).call(F, function(t) { return M()(e).call(e, t) > -1 })    })(e) && (o += "/toutiao");    var i = { url: o + e };    t.data && (i.body = t.data);    return (null === (a = null === (r = window.byted_acrawler) || void 0 === r         ? void 0 : r.sign) || void 0 === a ? void 0 : a.call(r, i)) || "";}
```

**关键发现：签名的核心是 `window.byted_acrawler.sign({ url, body? })` 。**

> 注意：最初误以为 `U = n("3ccdee7f73a129e65729")` 是签名函数，但实际该模块只是 `collectEvent` （事件收集函数）。真正的 U 是模块内部定义的函数。

---

## 第二阶段：acrawler.js SDK 分析

### 2.1 定位 SDK 加载脚本

从页面所有 `<script src>` 标签中找到：

```bash
https://lf3-cdn-tos.bytescm.com/obj/rc-web-sdk/acrawler.js
```

页面中的初始化代码（内联 script）：

```javascript
window.byted_acrawler && window.byted_acrawler.init({aid: 24, dfp: !0});
```

### 2.2 SDK 基本信息

```makefile
文件大小: 71,721 字节SDK 对象: window.byted_acrawler导出方法: BytedAcrawler, getReferer, init, sign
```

### 2.3 sign 函数分析

在浏览器中调用 sign 函数观察行为：

```javascript
// 输入const testInput = {    url: "https://www.toutiao.com/toutiao/article/v4/tab_comments/?aid=24&app_name=toutiao_web&offset=0&count=20&group_id=7630793912500437540&item_id=7630793912500437540"};// 输出const result = window.byted_acrawler.sign(testInput);// => "_02B4Z6wo00d01UlfSGQAAIDAM7a8gdCuh-lJe2zAADu1EMd9ISPaYsp2BtNF1B9tB4G.fjs.sQ5HZUKAR8z0je.Th82olUTnHMBQRSkck9hxUXDZjthy-dtjbG9vtEVAqt2NaHJNoTbDkhizfa"// 长度: 147, 类型: string
```

**关键特征：**

- 签名前缀固定为 `_02B4Z6wo`
- 相同输入产生相同输出（确定性）
- 不同URL产生不同签名

### 2.4 VM 保护机制分析

acrawler.js 使用 `_$jsvmprt` 虚拟机保护：

```javascript
var glb;(glb = "undefined" == typeof window ? global : window)._$jsvmprt = function(b, e, f) {    // ... VM 解释器实现（约 9,800 字节）    // b: 字节码（hex 字符串）    // e: 外部引用数组    // f: 全局命名空间};// VM 入口调用(glb = ...)._$jsvmprt("484e4f4a403f5243000d2d1aea78...", [,, exports, module, ...]);
```

**VM 解释器关键结构：**

- 魔数验证: `HNOJ@?RC` （hex `484e4f4a403f5243` ）
- 字节码长度: 60,358 hex 字符 (30,179 字节)
- 字符串常量池: 使用 XOR 2 加密
- 操作码调度: `13*j%241` 计算操作类型
- 栈式虚拟机: 使用栈 S\[\] 和栈指针 R

### 2.5 字节码字符串解密

发现字节码中的字符串使用 **XOR 2** 简单加密：

```javascript
// 验证过程const pairs = [    ['function', 'dwlavkml'],   // XOR: [2,2,2,2,2,2,2,2]    ['object', 'm\`hgav'],       // XOR: [2,2,2,2,2,2]    ['undefined', 'wlfgdklgf'], // XOR: [2,2,2,2,2,2,2,2,2]    ['exports', 'gzrmpvq'],    // XOR: [2,2,2,2,2,2,2]];// 全部为 XOR 2
```

解密后得到 **663 个唯一字符串** ，揭示了 SDK 的完整功能：

**环境检测函数：**

```js
(domDetect,
  hookDetect,
  nodeDetect,
  phantomDetect,
  webdriverDetect,
  incognitoDetect,
  debuggerDetect,
  locationDetect);
```

**指纹收集函数：**

```js
(getGpu,
  getPlugins,
  canvas_fingerprint,
  getAbilities,
  getResolution,
  getBatteryInfo,
  getTouchInfo,
  getTimezone,
  getFonts,
  getSyntaxError,
  getNativeLength,
  getRtcIp);
```

**签名相关：**

```css
getSignature, assembleResult, assembleParams, directSign,xxtea, encrypt, decrypt, base64StandardB[custom_table]
```

\***\*加密算法标识：\*\***

```apache
base64StandardBDkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCebase64_charIndexBABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/xxtea, encryptUint32Array, decryptUint32Array0
B4Z6wo (签名版本标记)2.11.0 (SDK版本)
```

### 2.6 签名结构解码

```javascript
签名格式: _02 + B4Z6wo + 模式标志 + 自定义Base64编码的XXTEA密文示例: _02B4Z6wo00d01gIwI.AAAIDDeNnXFaMQGJoCFAdAAOl4EMd9ISPa...      ^^^ ^^^^^^ ^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^      前缀 版本   模式  自定义Base64编码数据自定义Base64表: Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCeURL安全变换: '+' → '-', '/' → '.'
```

**解码验证：**

```javascript
// 浏览器签名 (147字符) 解码后: 103字节 payload// Node签名 (47字符) 解码后: 28字节 payload// 差异的 75 字节 = 设备指纹数据
```

## 第三阶段：Node.js 环境还原（第一版 — 47字符签名）

### 3.1 初始方案：VM sandbox + 浏览器环境模拟

创建 `browser_env.js` 模拟浏览器API：

- MockCanvas / MockCanvas2D / MockWebGL
- MockPluginArray / MockStorage
- window / document / navigator / screen / location / history
- 各种全局构造函数

创建 `sign.js` 封装签名逻辑：

- 使用 `vm.createContext` 创建沙箱
- 加载 acrawler.js 到沙箱
- 调用 `byted_acrawler.init()` 和 `byted_acrawler.sign()`

### 3.2 初始测试结果

```
sig: _02B4Z6wo00f01DZdJQwAAIDAX-a2CPLZBSw2fyGAAGR325
len: 45
```

签名生成成功但只有 45-47 字符（00f模式），浏览器中为 147 字符（00d模式）。

### 3.3 第一次问题排查：init 参数

发现页面调用 `window.byted_acrawler.init({aid:24, dfp:true})` ，添加后签名长度未变。

### 3.4 验证短签名是否可用

```cs
// 使用 47 字符签名请求 APIconst resp = await axios.get(fullUrl, { headers: {...} });// 结果: Status 200, message: "success", 返回 20 条评论
```

**47字符签名可以通过API验证！** 但为了完整还原，继续追踪长度差异。

---

## 第四阶段：深入分析签名长度差异

### 4.1 浏览器 iframe 对比测试

在浏览器中创建干净 iframe 环境测试：

```javascript
// iframe 中不调用 init:     147字符 (00f模式)// iframe 中调用 init:       147字符 (00f模式)// iframe 中等待2秒后:       147字符 (00f模式)// iframe 中破坏 domDetect:  147字符 (仍然完整！)
```

**关键发现：浏览器 iframe 中无论是否 init、无论 domDetect 是否通过，签名都是 147 字符。**

### 4.2 排查 \_byted_param_sw 开关

通过追踪 localStorage/sessionStorage 读写：

```cs
// Node.js 中 sign 时读取:[ss.get] _byted_param_sw -> null[ls.get] _byted_param_sw -> null[ss.get] tt_scid -> null// 浏览器 iframe 中 sign 时读取:[ss] _byted_param_sw -> b5imwGI5RY3dvI5rzww=[ls] _byted_param_sw -> b5imwGI5RY3dvI5rzww=[ss] tt_scid -> Wlcj-nStWBBQxGhmY7Q8AiTVPYpNsC7F6zTNhO8MdF3...
```

但进一步测试证明： **即使清除 `_byted_param_sw` ，浏览器签名仍然是 147 字符** 。这不是根因。

### 4.3 定位 VM 内部的关键分支

通过在字节码中搜索关键字符串（XOR 2 加密后的偏移量），定位到 `getSignature` 函数：

```swift
偏移 54286: getSignature"url.nonce must be an object with a url property!"
偏移 54410: domNotValidprotocol
偏移 54452: 000000000011
偏移 54486: forreal偏移 54502: debug偏移 54514: nonce偏移 54526: bodyVal2str=
=
偏移 54652: nonceStr偏移 54770: navigatorSignals偏移 55064: windowSignals偏移 55380: documentSignals偏移 55854: webglSignals
```

**`getSignature` 的逻辑：**

1. 检查 `domNotValid` 标志
2. 如果 DOM 无效 → 使用 `0000` / `00000011` 生成精简签名（28字节）
3. 如果 DOM 有效（ `forreal` ）→ 收集完整指纹：navigatorSignals, windowSignals, documentSignals, webglSignals 等（103字节）

### 4.4 domDetect 检测机制

从字节码字符串定位 `domDetect` 函数（偏移 44588）：

```javascript
检查项:1. Object.prototype.toString.call(window) 包含 "[object Window]"2. Object.prototype.toString.call(document) 包含 "Document"3. Object.prototype.toString.call(navigator) 包含 "[object Navigator]"4. Object.prototype.toString.call(history) 包含 "[object History]"
```

### 4.5 VM sandbox 中的 toString 问题

```javascript
// 在 vm.createContext 外部:Object.prototype.toString.call(env) // => "[object Window]" (通过 Symbol.toStringTag)// 在 vm.createContext 内部:// this (全局对象) => "[object Object]"  ← 这是 V8 vm 模块的限制！// document => "[object HTMLDocument]"    ← Symbol.toStringTag 生效// navigator => "[object Navigator]"     ← 生效// history => "[object History]"          ← 生效
```

\***\*修复：** Hook `Object.prototype.toString` ，对全局对象返回 `[object Window]` ：\*\*

```kotlin
vm.runInContext(\`    (function(){        var _o = Object.prototype.toString;        var _g = this;        Object.prototype.toString = function(){            try { if (this === _g) return "[object Window]"; } catch(e) {}            return _o.call(this);        };    })();\`, context);
```

### 4.6 hookDetect 绕过

`hookDetect` 检查 `createElement` 和 `toDataURL` 的 `toString()` 是否包含 `native code` ：

```css
// hookDetect 的检测逻辑:document.createElement.toString().replace(/\s*/g, '').indexOf('nativecode') > -1canvas.toDataURL.toString().replace(/\s*/g, '').indexOf('nativecode') > -1
```

\***\*修复：** 使用 `nativeFn` 包装函数的 toString：\*\*

```javascript
function nativeFn(name, fn) {    fn.toString = () => \`function ${name}() { [native code] }\`;    return fn;}
```

### 4.7 instanceof 安全化

VM 字节码中 `instanceof` 操作可能遇到 `undefined` 的构造函数（如某些浏览器中不存在的 API），导致 `TypeError: Right-hand side of 'instanceof' is not an object` 。

**修复：** 在 acrawler.js 源码中 patch VM 解释器的 instanceof 操作：

```swift
// 原始: S[R]=S[R]instanceof C// 修复: S[R]=(typeof C==="function"||typeof C==="object"&&C!==null)?S[R]instanceof C:falseacrawlerCode = acrawlerCode.replace(    /S\[R\]=S\[R\]instanceof C/g,    'S[R]=(typeof C==="function"||typeof C==="object"&&C!==null)?S[R]instanceof C:false');
```

## 第五阶段：发现 JSONP 请求（根因突破）

### 5.1 追踪 script 标签创建

在 document.createElement 中添加追踪，发现 `init()` 期间 acrawler 通过 JSONP 发起了两个网络请求：

```bash
[SCRIPT SRC] https://xxbg.snssdk.com/websdk/v1/p?callback=_9608_1776705427332[SCRIPT SRC] https://xxbg.snssdk.com/websdk/v1/getInfo?q=zoTh8B8P6NLJRY...&callback=_5741_1776705427362
```

### 5.2 JSONP 请求分析

**请求 1 — 获取参数开关：**

```bash
URL: https://xxbg.snssdk.com/websdk/v1/p?callback=_9608_xxx响应: _9608_xxx("hfk1bFcH2Y5lTETUkxI=");作用: 设置 _byted_param_sw（签名参数开关）
```

\***\*请求 2 — 提交指纹、获取配置：\*\***

```makefile
URL: https://xxbg.snssdk.com/websdk/v1/getInfo?q=[加密的指纹数据]&callback=_5741_xxx响应: _5741_xxx({...配置数据...});作用: 提交设备指纹，获取签名配置参数
```

### 5.3 根因确认

**这些 JSONP 回调的执行结果设置了 acrawler 内部状态，决定签名是否包含完整设备指纹。**

在浏览器中：script 标签被添加到 DOM → 浏览器发起网络请求 → 回调执行 → 内部状态更新 → 签名包含完整数据（147字符）

在 Node.js 中：script 标签创建了但没有真正发起网络请求 → 回调从未执行 → 内部状态不完整 → 签名走精简路径（47字符）

### 5.4 修复方案

在 `sign.js` 中拦截 script 标签的 src 设置，当检测到 HTTP URL 时用 Node.js 的 `https` 模块发起真实请求：

```javascript
// 拦截 script 标签创建const pendingJsonp = [];sandbox.document.createElement = function(tag) {    if (tag === 'script') {        const scriptEl = { src: '', onload: null, onerror: null };        Object.defineProperty(scriptEl, 'src', {            set(v) {                if (v && v.startsWith('http')) {                    pendingJsonp.push({ el: scriptEl, url: v });                }            }        });        return scriptEl;    }    // ...};// init 后执行所有 JSONP 请求for (const { el, url } of pendingJsonp) {    const responseText = await fetchUrl(url);    vm.runInContext(responseText, context);  // 执行 JSONP 回调    if (el.onload) el.onload();}
```

`init()` 方法改为异步： `async init()` 以等待网络请求完成。

---

## 第六阶段：最终验证

### 6.1 签名长度验证

```http
sig: _02B4Z6wo00f01U-H5SgAAIDBCYbwbxJ1.I1PoeGAADoLlkxz1n1EH0BuRRImZR247k6q3x-mjdgfy5KTEXYmKrCJRiryNUiDvDjXhxx8guv6ItLCrw0LB.AZdAC0WHLfyBPh6bqaJ.gssVt83dlen: 147mode: o00f
```

### 6.2 API 请求验证

```cs
=== 头条 _signature 签名生成 — 纯 Node.js 实现 ===[1] 初始化签名器（含 JSONP 请求）...    完成[2] 生成 _signature...    _signature = _02B4Z6wo00f01TivK4wAAIDBfq4-yC.FhFE4iS8AACfQ4T8Of5efS-J8Ap1y...    长度: 147    模式: o00f[3] 一致性检查...    相同输入 => 相同输出: 是    不同URL => 不同签名: 是[4] 调用头条评论API...    请求成功! 返回 20 条评论    [1] 海纳之坊: 我们汶川地震发生的时候，日本人也为我们筹款赈灾...122
    [2] 洒脱艺术家G: 人没 事就好！64
    [3] 真理永存123sss: 7.7级对于日本来说没事的...6
    [4] 元宝泽临: 没啥影响的，意林说过...5
    [5] 焕然: 中国航母过日本海地震，这次舰艇编队过去又地震...8
=== 完成 ===
```

## 技术总结

### 签名完整流程

```bash
1. 页面加载 acrawler.js (71KB, _$jsvmprt VM 保护)     ↓2. 页面调用 byted_acrawler.init({aid:24, dfp:true})     ↓3. init 内部通过 JSONP 请求 xxbg.snssdk.com/websdk/v1/p 获取参数开关     ↓4. init 内部收集设备指纹（canvas/WebGL/字体/插件/UA等）     ↓5. init 内部通过 JSONP 请求 xxbg.snssdk.com/websdk/v1/getInfo 提交指纹     ↓6. JSONP 回调设置内部状态（签名参数、设备ID等）     ↓7. axios 拦截器调用 U(url, config)      ↓8. U() 构造 {url: "https://www.toutiao.com/toutiao/..."} 传给 sign     ↓9. byted_acrawler.sign() 内部:   a. 检查 domNotValid（DOM环境检测）   b. 如果有效: 收集 navigatorSignals + windowSignals + documentSignals + webglSignals   c. 组装签名数据: pathname + tt_webid + nonceStr + 指纹数据   d. XXTEA 加密 (delta=0x9E3779B9)   e. 自定义 Base64 编码 (Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe)   f. URL 安全转换 ('+' → '-', '/' → '.')   g. 添加前缀 "_02" + "B4Z6wo" + 模式标志     ↓10. 返回签名字符串 (147字符, 如: _02B4Z6wo00f01TivK4w...)
```

### 环境检测绕过清单

```javascript
| 检测 | 检测方式 | 绕过方式 | 状态 ||------|---------|---------|------|| domDetect | \`toString.call(window)\` = \`[object Window]\` | vm 内 hook Object.prototype.toString | ✅ || domDetect | \`toString.call(document)\` 含 \`Document\` | Symbol.toStringTag = 'HTMLDocument' | ✅ || domDetect | \`toString.call(navigator)\` = \`[object Navigator]\` | Symbol.toStringTag = 'Navigator' | ✅ || domDetect | \`toString.call(history)\` = \`[object History]\` | Symbol.toStringTag = 'History' | ✅ || hookDetect | \`createElement.toString()\` 含 \`native code\` | nativeFn 包装 toString | ✅ || hookDetect | \`toDataURL.toString()\` 含 \`native code\` | nativeFn 包装 toString | ✅ || hookDetect | \`toString.call(plugins)\` = \`[object PluginArray]\` | Symbol.toStringTag = 'PluginArray' | ✅ || nodeDetect | \`typeof process !== 'undefined'\` | sandbox 中不设 process | ✅ || phantomDetect | \`_phantom\`, \`callPhantom\`, \`__nightmare\` | 不定义这些全局变量 | ✅ || webdriverDetect | \`navigator.webdriver\` | 设为 false | ✅ || webdriverDetect | \`__webdriver_evaluate\` 等 | 不定义 | ✅ || instanceof | 对 undefined 构造函数执行 instanceof | patch VM 解释器安全化 | ✅ || JSONP 请求 | init 通过 script src 加载外部数据 | Node.js https 模块真实请求 | ✅ |
```

### 死胡同记录

以下是分析过程中走过的弯路：

1. **误以为 `_byted_param_sw` 是签名长度的开关**
   — 实际清除后浏览器签名仍然147字符
2. **误以为 `domDetect` 通过就能解决**
   — 通过 toString hook 让 domDetect 通过后签名仍然47字符
3. **误以为 VM 中正则不工作**
   — 实际是测试代码中反斜杠转义问题（ `\\\\s` vs `\s` ），VM 内部正则完全正常
4. **尝试传入外部 RegExp 修复 replace**
   — 不必要，replace 在 VM 中本身就正确工作
5. **误以为 `init()` 是同步完成的**
   — 实际 init 内部通过 JSONP 异步加载配置数据，这才是根因

### 项目文件结构

```
toutiao_signature/
├── acrawler.js          # 字节跳动原始 SDK (71KB, _$jsvmprt VM 保护)
├── browser_env.js       # 浏览器 API 模拟层
├── sign.js              # ToutiaoSigner 签名生成器 (async init + JSONP)
├── demo.js              # 使用示例
├── package.json         # 项目配置 (依赖: axios)
├── node_modules/        # npm 依赖
├── Reverse_Report_CN.md # 简版分析报告
└── 逆向分析全过程.md    # 本文档
```

### 使用方法

```javascript
const {ToutiaoSigner} = require('./sign');
const signer = new ToutiaoSigner({cookie: 'tt_webid=xxx; ttcid=xxx'});
await signer.init(); // 异步初始化（含 JSONP 请求）const signature = signer.sign(    'https://www.toutiao.com/article/v4/tab_comments/?aid=24&app_name=toutiao_web&offset=0&count=20&group_id=xxx&item_id=xxx');// => "_02B4Z6wo00f01..." (147字符)
```

## 附录：关键代码执行结果全记录

### A1. 浏览器中 sign 函数调用

```javascript
// 输入const input = { url: "https://www.toutiao.com/toutiao/article/v4/tab_comments/?aid=24&..." };// 输出sign(input) => "_02B4Z6wo00d01UlfSGQAAIDAM7a8gdCuh-lJe2zAADu1EMd9ISPaYsp2BtNF1B9tB4G.fjs.sQ5HZUKAR8z0je.Th82olUTnHMBQRSkck9hxUXDZjthy-dtjbG9vtEVAqt2NaHJNoTbDkhizfa"// length: 147, deterministic: true
```

### A2. XOR 2 字符串解密验证

```php
function  -> dwlavkml   (XOR: [2,2,2,2,2,2,2,2])object    -> m\`hgav     (XOR: [2,2,2,2,2,2])undefined -> wlfgdklgf  (XOR: [2,2,2,2,2,2,2,2,2])exports   -> gzrmpvq    (XOR: [2,2,2,2,2,2,2])
```

### A3. JSONP 请求响应

```javascript
// 请求1: 参数开关GET https://xxbg.snssdk.com/websdk/v1/p?callback=test123响应: test123("hfk1bFcH2Y5lTETUkxI=");// 请求2: 指纹提交GET https://xxbg.snssdk.com/websdk/v1/getInfo?q=[encrypted_data]&callback=_5741_xxx响应: _5741_xxx({...配置数据...});
```

### A4. 最终 demo.js 运行输出

```cs
=== 头条 _signature 签名生成 — 纯 Node.js 实现 ===[1] 初始化签名器（含 JSONP 请求）...    完成[2] 生成 _signature...    _signature = _02B4Z6wo00f01TivK4wAAIDBfq4-yC.FhFE4iS8AACfQ4T8Of5efS-J8Ap1y.hy.wqJC5yczhpnfjIjpb2yvyhMk4qp6VfUavJZPBRZVq39cN-ceV0RVrPD0dudA5-4xP4IYcKbPrT6.xOnTa4    长度: 147    模式: o00f[3] 一致性检查...    相同输入 => 相同输出: 是    不同URL => 不同签名: 是[4] 调用头条评论API...    请求成功! 返回 20 条评论    [1] 海纳之坊: 我们汶川地震发生的时候，日本人也为我们筹款赈灾，在共同的人类灾难面前，我们是不是也要发挥大度的精神。。。。？122
    [2] 洒脱艺术家G: 人没 事就好！64
    [3] 真理永存123sss: 7.7级对于日本来说没事的，因为日本的地形特扛震，没有8.9以上几乎没有多大影响6
12
5
    [5] 焕然: 中国航母过日本海地震，这次舰艇编队过去又地震，太神奇了！8
=== 完成 ==
```

---
