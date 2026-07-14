# 反检测（Stealth）与设备模拟（Emulation）

当目标站点有反爬检测（Cloudflare、Akamai、自实现指纹），或要复现特定设备（移动端、弱机、低速网络），需要 stealth + emulation 组合。

---

## 反检测（Stealth）

### 一键隐身脚本

```
# 1. 看可用预设
list_stealth_presets
# → ["default", "chrome-desktop", "firefox-desktop", "mobile-iphone", "minimal", ...]

# 2. 看具体功能
list_stealth_features
# → ["hide-webdriver", "mock-chrome", "canvas-noise", "webgl-mask", "audio-fp-mask", ...]

# 3. 注入预设
inject_stealth --preset <name>
```

### 隐身能力清单（典型站点检测 → 对应屏蔽）

| 检测点                                      | 隐身能力                  |
| ------------------------------------------- | ------------------------- |
| `navigator.webdriver === true`              | hide-webdriver            |
| `window.chrome.runtime` 缺失                | mock-chrome               |
| Canvas 指纹                                 | canvas-noise              |
| WebGL 指纹                                  | webgl-mask                |
| AudioContext 指纹                           | audio-fp-mask             |
| 字体枚举                                    | font-mask                 |
| `navigator.plugins` / `navigator.languages` | plugin-mask / locale-mask |
| 屏幕 / 视口异常                             | screen-mask               |

### 自定义 UA

```
set_user_agent --userAgent "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ..."
```

> UA 与 `emulate_mobile --device "iPhone 14"` 配合使用才有效（否则 UA 写了但视口还是桌面）。

### stealth 注入的时机

- **`new_page` 时**：用 `--preloadPreset <name>` 在导航前注入
- **运行时注入**：`inject_stealth` 立即生效（已加载的页面脚本会受影响）

---

## 设备模拟（Emulation）

### 移动端

```
# 用 preset（推荐：iPhone / iPad / Android 都有）
emulate_mobile --enable true --device "iPhone 14 Pro"

# 自定义视口（独立于 device preset）
resize_page --width 390 --height 844
```

### 网络限速

```
emulate_network --throttlingOption "Slow 3G"
# 选项：Online / Slow 3G / Fast 3G / Slow 4G / Fast 4G / Offline
```

### CPU 节流

```
emulate_cpu --throttlingRate 4   # 4 倍减速（模拟低端机）
```

### 视口

```
resize_page --width 1920 --height 1080
```

---

## 组合用法

### 模拟 iPhone + 弱网 + stealth

```
emulate_mobile --enable true --device "iPhone 13"
emulate_network --throttlingOption "Slow 3G"
emulate_cpu --throttlingRate 4
set_user_agent --userAgent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ..."
inject_stealth --preset "mobile-iphone"
```

### 验证隐身效果

```
# 检查 navigator.webdriver
evaluate_script --function "() => navigator.webdriver"
# → undefined（成功隐身）或 true（未生效）

# 检查 plugins
evaluate_script --function "() => navigator.plugins.length"
# → 真实值（3-5 之类）
```

---

## 何时用哪种

| 目标                 | 用什么                                                            |
| -------------------- | ----------------------------------------------------------------- |
| 站点检测了 webdriver | `inject_stealth --preset chrome-desktop` + `set_user_agent`       |
| 站点检测了 canvas    | `inject_stealth --preset default`（含 canvas-noise）              |
| 站点是移动端 only    | `emulate_mobile --device "iPhone 14"` + mobile UA + mobile preset |
| 想看页面在弱网下表现 | `emulate_network --throttlingOption "Slow 3G"`                    |
| 性能分析             | `emulate_cpu --throttlingRate 4` + `start_performance_trace`      |
| 自定义视口截图       | `resize_page --width 1440 --height 900` + `take_screenshot`       |

---

## 失败回退

| 现象                            | 解决                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `inject_stealth` 后检测仍然命中 | 用 `evaluate_script` 看具体命中点；按检测点单独 patch |
| 隐身脚本与业务 JS 冲突          | 改用 minimal preset，逐项加                           |
| 移动端 UA 但视口是桌面          | 一定配合 `emulate_mobile`                             |
| 隐身导致某些功能不工作          | 取消对应 `feature` 注入；或换 minimal                 |

完整 stealth 引擎实现：`src/modules/stealth/StealthScripts2025.ts`（60+ 项反检测启动参数）。
