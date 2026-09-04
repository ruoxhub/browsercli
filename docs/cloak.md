# CloakBrowser 集成（`--cloak`）

`--cloak` 是 JSReverser 的强反爬逃生通道：用 CloakBrowser 的 Chromium 二进制
替换系统 Chrome，叠加 49 个 C++ 源码层指纹 patch（canvas / WebGL / audio /
GPU / 字体 / 屏幕 / WebRTC / TLS 等）。

默认情况（不带 `--cloak`）**不启用**。默认走系统 Chrome + Patchright 协议层
反检测（不调 `Runtime.enable`/`Console.enable`、不在页面里注入任何 JS）—— 这
是 jshookmcp 的"零 JS 注入"哲学，对绝大多数站点都够用。

## 什么时候该开 `--cloak`

只当协议层 + 系统 Chrome 已经被站点指纹拦截时再启用。常见信号：

- Cloudflare Turnstile 反复 challenge 死循环
- DataDome / FingerprintJS 直接 403
- 知乎等国内强反爬站点返回 40362 / 滑块死循环
- 站点前端调用 `navigator.webdriver`、canvas 指纹、WebGL 渲染器等复合检测

**不要默认开**。CloakBrowser 二进制 ~200MB，启动耗时更长，且 49 个 C++ patch
在某些站点会引入与真实 Chrome 不一致的渲染差异（反而被检测）。

## 预下载二进制（强烈推荐）

首次启动带 `--cloak` 的 worker 时，`cloakbrowser` 包会触发 ~200MB 二进制下载。
为避免下载进度条污染 worker 启动日志，建议先离线下载好：

```bash
npx cloakbrowser install
```

（`cloakbrowser` 通过 `optionalDependencies` 安装，这条命令只触发它自带的
二进制下载逻辑，有进度条。）

## Profile 物理隔离

`--cloak` 启用后，profile 目录自动切到 `~/.cache/chrome-devtools-mcp/cloak-profile`
（默认模式在 `chrome-profile`）。**两者不能共享**：

- CloakBrowser 是定制 Chromium 编译版（patch 了 49 个 C++ 指纹点、移除了
  Google 服务 / Web Store）
- 默认模式用系统 Chrome（带 Web Store、扩展、sync）

混用 profile 会导致 shader cache、service worker、扩展注册表互踩，引发启动
race 和会话崩溃。详见 `src/modules/browser/browser-helpers.ts::resolveUserDataDir`。

## 指纹种子持久化

每个 cloak profile 目录下落一个 `.cloak-seed` 文件（5 位随机整数）。只要不删
该文件，同一 profile 每次启动呈现**相同的虚拟身份**（稳定的"回访访客"）。

`--isolated` 模式下 seed 不落盘，每次启动用新 seed（全新访客）。

## Windows 指纹预设（即便跑在 macOS/Linux 上）

`setupCloak()` 始终把 `--fingerprint-platform=windows` 传给 CloakBrowser。

理由：CloakBrowser 在 Windows/Linux 构建上有 57 个 C++ patch，在 macOS 构建上
只有 26 个（其 README 明确说 macOS 构建保留真实 GPU 字符串、spoof 值反而更
易被识别）。对本项目的用例（调试强反爬站点），完整 Windows 指纹预设是更稳
的选择 —— 激活全部 patch、呈现反爬数据库里最常见的 Windows 桌面指纹。

CloakBrowser 自己的故障排查（README "macOS: Blocked on some sites that pass
on Linux" 一节）也推荐这条路径："switch to a Windows fingerprint profile by
passing `stealth_args=False` and manually setting
`--fingerprint-platform=windows`"。

## 用法

### CLI 启动 worker

```bash
js-reverse start --cloak --browserUrl http://127.0.0.1:9222
```

或同时叠加 JS 注入（不推荐，通常 cloak 已够用）：

```bash
js-reverse start --cloak --js-stealth
```

### 配置文件

`~/.jsreverse/config.json`：

```json
{
  "cloak": true
}
```

### 环境变量

```bash
export BROWSER_CLOAK=true
js-reverse start
```

## 与其他 stealth flag 的关系

| Flag                  | 作用                                                                 | 默认    |
| --------------------- | -------------------------------------------------------------------- | ------- |
| `--cloak`             | CloakBrowser 二进制 + 49 C++ patch + cloak-profile                   | `false` |
| `--js-stealth`        | 页面里注入 `StealthScripts2025`（覆盖 navigator/canvas/WebGL/audio） | `false` |
| `--full-stealth-args` | 使用历史 60+ Chromium 启动参数集（多个 flag 已是检测信号，不推荐）   | `false` |

默认情况下 worker 只用最小启动参数集（`MINIMAL_STEALTH_ARGS`：`--test-type`
banner 抑制 + `--hide-crash-restore-bubble`），反检测能力由协议层
（Patchright）+ 源码层（cloak 启用时）提供。

详见 `src/modules/browser/stealth-args.ts` 与 `src/modules/browser/cloak.ts`。
