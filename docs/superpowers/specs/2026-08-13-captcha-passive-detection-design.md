# CAPTCHA 被动检测迁移设计

> 状态：已批准 · 日期：2026-08-13 · 迁移方式：Clean-room 行为重写 · 交付边界：内部模块 + 一个只读 MCP 工具

## 1. 摘要

本设计为当前项目补充一个显式调用、只读、规则驱动的 CAPTCHA 检测模块，以及一个薄的 `detect_captcha` MCP 工具。检测仅观察当前已选页面的 URL、标题、有限可见文本和顶层 DOM 结构，输出可解释的证据、排除证据、置信度与下一步建议。

本次不迁移自动求解、外部打码服务、AI 图片识别、截图持久化、浏览器模式切换、后台监听或启动期注入。检测失败不会伪装成“未检测到”，等待超时也不会伪装成工具错误。

## 2. 背景与问题

当前项目已有浏览器生命周期、页面选择、输入、截图、AI 服务和工具响应管线，但没有 CAPTCHA 领域模块。调用方无法通过稳定接口回答以下问题：

- 当前页面是否存在 CAPTCHA 或人机挑战？
- 结论由哪些相互独立的页面信号支持？
- “验证码”是 CAPTCHA，还是短信码、邮箱码或双因素认证？
- 如果结论不确定，应该继续、观察、请求更高层分析还是人工处理？
- 人工处理后，页面上的挑战是否已经稳定消失？

仓库已有的 [`2026-08-11-jshookmcp-migration-design.md`](./2026-08-11-jshookmcp-migration-design.md) 规定，参考仓库采用 AGPL-3.0-only，而当前项目采用 Apache-2.0；后续能力必须以独立规格和 clean-room 行为重写方式进入，不能复制或逐行改写上游源码、类型或测试。

## 3. 目标

1. 新增可独立复用的 CAPTCHA 被动检测模块。
2. 基于 URL、标题、可见文本和 DOM 结构生成结构化证据。
3. 显式排除短信码、邮箱验证、账户验证和 2FA 等常见误报。
4. 以确定性规则区分 `detected`、`suspected` 和 `not_detected`。
5. 提供 `waitForClear`，用于观察人工处理后的挑战是否稳定消失。
6. 新增一个只读 `detect_captcha` 工具，复用当前已选页面和现有响应管线。
7. 保持默认浏览器启动、零 JS 注入、CDP 懒激活和 profile 隔离策略不变。
8. 新模块相关测试覆盖率不低于 80%。

## 4. 非目标

本次明确不包含：

- 自动点击、拖拽、填写、提交或注入 CAPTCHA token。
- 对接付费或远程打码服务。
- 自动截图、截图落盘或把页面图像发送给 AI。
- 自动调用现有 `AIService`、`LLMService` 或任何外部网络服务。
- 自动切换 headless/headed、重启浏览器或修改 BrowserManager 配置。
- 导航后自动检测、后台轮询、事件监听或全局状态缓存。
- 启动脚本、`addInitScript`、`StealthScripts2025` 或其他 JS 隐式注入。
- eager `Runtime.enable`、`Console.enable`、`Debugger.enable` 或新的 CDP 会话。
- 穿透跨源 iframe、递归 shadow root 或识别所有厂商专有变体。
- 默认 CAPTCHA 自动求解。

## 5. 许可证与 clean-room 边界

### 5.1 允许依据

实现只能依据：

- 本规格中已批准的行为与接口；
- 当前 Apache-2.0 仓库的既有代码和约定；
- 浏览器标准 DOM API 与 Patchright 的公开 API；
- 独立构造的测试页面和输入样例。

### 5.2 禁止事项

- 不复制、改写或翻译 `open-source/jshookmcp` 下的实现、类型、规则表、测试或 fixture。
- `src/`、`tests/`、依赖和构建产物不得引用 `open-source/jshookmcp` 包或内部路径。
- 不为追求行为一致而读取上游私有实现细节；本规格未定义的行为按最小、安全原则处理，不能以上游源码补空白。

### 5.3 执行隔离

发现阶段曾在确认许可证边界前打开参考实现。为保持 clean-room 过程，生产代码和测试的实现必须在新的、未读取参考实现的执行上下文中进行；该上下文只接收本规格、后续实现计划和当前仓库代码。当前会话可以完成规格与实现计划，但不直接编写生产实现。执行使用新的隔离 git worktree，避免当前工作区的未提交修改进入 CAPTCHA 差异。

## 6. 选定方案与被拒方案

### 6.1 选定：纯规则、显式调用

采用本地确定性规则。模块不依赖外部服务，只有调用 `assess()` 或 `waitForClear()` 时才读取页面。歧义结果可建议 `ask_ai`，但模块自身不调用 AI。

选择原因：

- 行为确定、可测试、无费用和网络不稳定性；
- 最符合只读、最小迁移与 clean-room 边界；
- 不改变默认浏览器生命周期和反检测分层；
- 误报与漏报都能通过结构化证据复盘。

### 6.2 被拒：规则后自动调用 AI

该方案会引入截图、隐私、费用、模型配置和非确定性结果，不属于本次最小交付。

### 6.3 被拒：导航后自动检测

该方案会改变默认运行时行为，增加页面执行次数和检测面，并需要生命周期、去抖与清理设计。本次只提供显式工具调用。

## 7. 架构与文件职责

### 7.1 新增文件

| 文件                                                 | 单一职责                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `src/modules/captcha/types.ts`                       | 定义公共状态、类型、证据、评估和等待结果。                     |
| `src/modules/captcha/rules.ts`                       | 保存产品无关、不可变的正向与排除规则描述。不得包含浏览器 I/O。 |
| `src/modules/captcha/CaptchaDetector.ts`             | 读取有界页面快照、生成证据、聚合结论并等待稳定清除。           |
| `src/modules/captcha/index.ts`                       | 只导出已批准的稳定公共接口。                                   |
| `src/tools/page/detectCaptcha.ts`                    | 把当前已选页面适配到模块，并通过现有 `sendJson` 返回结果。     |
| `tests/unit/modules/captcha/CaptchaDetector.test.ts` | 验证检测、排除、隐私边界和等待状态机。                         |
| `tests/unit/tools/page/detectCaptcha.test.ts`        | 验证工具参数、上下文、响应和注册契约。                         |

### 7.2 修改文件

| 文件                                 | 修改原因                                                    |
| ------------------------------------ | ----------------------------------------------------------- |
| `src/tools/page/manifest.ts`         | 将 `detectCaptcha` 加入现有 page 工具域。                   |
| `src/tools/page/index.ts`            | 导出 `detectCaptcha`，保持 page 域入口一致。                |
| `src/tools/generated-tools-index.ts` | 运行项目生成器后纳入 `detectCaptcha` 注册项；不得手工编辑。 |

### 7.3 明确不修改

- 不向 `RuntimeServices` 增加服务。检测器无可变状态，不需要生命周期管理。
- 不修改 `BrowserManager`、启动参数、配置 schema 或 worker 上下文。
- 不新增工具分类或独立 manifest；工具属于现有 `page` 域和 `ToolCategory.PAGES`。
- 不修改生成的 `build/`。`src/tools/generated-tools-index.ts` 是受版本控制的生成源码，只能通过 `npm run build:index` 更新。

## 8. 公共模块契约

### 8.1 结果类型

```ts
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
```

`confidence` 表示“页面存在 CAPTCHA 的置信度”，不是对任意结论正确性的置信度。因此 `not_detected` 固定为 `0`，排除证据保存在 `exclusions` 中供调用方解释。

### 8.2 检测器 API

```ts
export class CaptchaDetector {
  assess(page: Page): Promise<CaptchaAssessment>;
  waitForClear(page: Page, timeoutMs?: number): Promise<CaptchaWaitResult>;
}
```

- `CaptchaDetector` 无可变跨调用状态。
- `assess()` 只读取传入页面，不写页面、文件或全局状态。
- `waitForClear()` 复用 `assess()`，不维护后台任务；Promise 结束后不残留计时器。
- 工具模块可持有一个无状态实例，不把它加入 `RuntimeServices`。

## 9. 页面快照与数据流

### 9.1 单次评估流程

1. 调用 `page.url()` 获取当前 URL。
2. 调用 `page.title()` 获取标题。
3. 通过一次显式 `page.evaluate` 读取顶层页面的有界 DOM 快照。
4. 规则层分别从 URL、标题、可见文本和 DOM 候选生成正向或排除证据。
5. 聚合器根据独立来源、强 DOM 证据和排除证据计算状态。
6. 返回固定顺序、可解释且有界的结果。

### 9.2 快照边界

快照只包含：

- `document.body?.innerText` 的前 4,000 个字符；不存在 `body` 时使用空字符串。
- 最多 32 个与产品无关候选选择器匹配的顶层元素。
- 候选元素的标签名、受限且截断的 `id`/`class`/`role`/`aria-label`/`src`/`title`/`alt`、可见性和交互标志。`src` 最多 2,048 个字符，其余单项最多 256 个字符。
- `data-sitekey` 等结构性属性只记录“是否存在”，不返回属性值。
- iframe 只读取元素自身的 `src`、`title` 和可见性，不进入 frame 内容。

快照禁止读取：

- `input.value`、`textarea.value`、表单提交数据；
- Cookie、Local Storage、Session Storage、IndexedDB；
- 页面脚本变量、网络响应或浏览器凭据；
- 跨源 iframe 内容；
- 完整 HTML 或完整正文。

URL 最多返回 2,048 个字符，标题最多返回 256 个字符。证据 `summary` 是规则定义的固定说明，不包含正文命中片段。DOM 证据可以返回产品无关选择器，但不返回候选元素文本。

元素只有同时满足以下条件才视为可见：仍连接在文档中、边界矩形宽高均大于零、计算样式的 `display` 不是 `none`、`visibility` 不是 `hidden`/`collapse`，且 `opacity` 大于零。英文匹配使用 NFKC 归一化后的小写文本；中文短语按归一化后的字面值匹配。URL 不做百分号解码，避免畸形转义改变控制流。

首版在快照实现旁保留一条有实际边界的注释：

```ts
// ponytail: Inspect only the top-level DOM and iframe metadata; add explicit
// frame/shadow traversal only after a reproducible miss demonstrates the need.
```

## 10. 规则与聚合语义

### 10.1 正向规则

规则必须产品无关，以结构或通用交互语义为依据。

强 DOM 证据包括：

- 可见 iframe 的 `src` 或 `title` 明确表达 CAPTCHA 或 human challenge；
- 存在公开的站点挑战键属性，但不读取其值；
- 可见元素同时具备 CAPTCHA/challenge 标识和 slider/draggable/slider-role 等交互语义；
- 可见 CAPTCHA 图像标识与图像元素结构同时成立；
- 可见 challenge/security-check 表单或容器具有明确的浏览器检查语义。

弱 DOM 证据包括：

- 可见元素只有泛化的 `captcha`、`verify` 或 `challenge` id/class/ARIA 标识，但缺少结构性确认。

URL、标题和文本规则均属于弱证据：

- URL 只检查路径和页面地址中的通用 CAPTCHA/challenge/bot-check/security-check 语义；单独的泛化 `verify` 不能形成确定结论。
- 标题和文本只匹配完整的人机验证、拖动滑块、选择图像、浏览器安全检查等中英文短语。
- 普通的 `verify`、`verification`、`code`、`security` 或“验证”单词不能单独形成正向证据。

### 10.2 排除规则

排除规则覆盖：

- 短信、邮箱、电话或账户 verification code；
- authenticator code、2FA、two-factor authentication；
- 密码重置、邮箱验证、手机验证和账户激活流程；
- 中文“输入验证码”“获取验证码”“短信验证码”“邮箱验证码”等登录或账户验证短语。

排除只抑制弱信号。明确的强 DOM 证据优先，防止页面同时出现登录验证码文案和真实 CAPTCHA 时漏报。

### 10.3 确定性聚合

定义：

- `positiveSources`：正向证据中不同 `source` 的集合。
- `hasStrongDom`：至少一个 `source === 'dom' && strength === 'strong'` 的正向证据。
- `hasExclusion`：至少一个排除证据。

状态按以下顺序计算：

1. `hasStrongDom` 为真：`detected`。
2. 否则，`positiveSources.size >= 2` 且无排除证据：`detected`。
3. 否则，只要存在正向证据：`suspected`。
4. 否则：`not_detected`。

`detected` 布尔值只在 `status === 'detected'` 时为 `true`；`suspected` 不伪装成已检测。

置信度使用固定档位，避免不可解释的浮点加权：

| 条件                              | 置信度 |
| --------------------------------- | -----: |
| 强 DOM 证据触发 `detected`        |     95 |
| 三个或四个独立来源触发 `detected` |     90 |
| 两个独立来源触发 `detected`       |     85 |
| 无排除证据的 `suspected`          |     50 |
| 存在排除冲突的 `suspected`        |     35 |
| `not_detected`                    |      0 |

### 10.4 类型、建议与输出顺序

`kind` 按以下优先级选择：

1. 第一条强 DOM 证据的非 `unknown` 类型；
2. 按 `dom`、`url`、`title`、`text` 来源顺序选择第一条非 `unknown` 类型；
3. 存在正向证据但无法分类时为 `unknown`；
4. `not_detected` 时为 `none`。

建议按以下规则选择：

- `detected` → `manual`；
- `suspected` 且存在排除冲突 → `ask_ai`；
- 其他 `suspected` → `observe`；
- `not_detected` → `continue`。

`evidence` 和 `exclusions` 分别以 `(ruleId, source, selector ?? '')` 为键去重，并按 `dom`、`url`、`title`、`text` 及规则声明顺序稳定输出。每类数组最多 20 条，防止异常 DOM 放大响应。

## 11. 稳定清除等待

`waitForClear()` 使用以下状态机：

1. 默认超时为 300,000 ms，固定轮询间隔为 2,000 ms；总预算从首次评估开始前计时。
2. 首次评估计入 `checks`；此字段统计所有 `assess()` 尝试，包括随后允许重试的瞬时导航失败。
3. 首次结果为 `not_detected` 时立即返回 `cleared: true`。
4. 首次结果为 `detected` 或 `suspected` 时进入等待。
5. 等待阶段只有连续两次 `not_detected` 才返回 `cleared: true`；任一 `detected` 或 `suspected` 将连续清除计数归零。
6. 到达超时时返回 `cleared: false` 和最后一次成功评估；超时是领域结果，不抛出工具错误。
7. 每次 sleep 不能超过剩余预算，函数结束时不得留下计时器。

等待期间的页面异常：

- `page.isClosed()` 为真时立即失败。
- 规范化后的错误消息只有匹配 `/execution context.*destroyed/i`、`/cannot find context/i` 或 `/frame.*detached/i` 时才视为瞬时导航错误，可重试最多连续三次；成功评估后错误计数归零。
- 第四次连续瞬时错误或任何非导航类错误立即失败。
- 失败不能转换成 `not_detected` 或计入连续清除次数。

模块 API 的 `timeoutMs` 接受正整数，非法值抛出 `RangeError`；工具层实施更严格的公共输入范围。单次 `assess()` 的标题与 DOM 快照读取共享 5,000 ms 的内部预算，超时按非导航类读取错误处理。

## 12. MCP 工具契约

### 12.1 定义

工具定义固定使用名称 `detect_captcha`、`ToolCategory.PAGES` 和 `readOnlyHint: true`。描述必须明确它只观察 CAPTCHA 信号，不求解或修改页面。

工具加入现有 page manifest，沿用 `workflow` profile，不新增别名或重复工具。

### 12.2 参数

```ts
{
  action?: 'detect' | 'wait_for_clear';
  timeout?: number;
}
```

- `action` 默认 `detect`。
- `timeout` 仅供 `wait_for_clear` 使用，必须是 1,000 到 300,000 之间的整数。
- `detect` 收到 `timeout` 时不改变行为；schema 描述明确说明该参数只用于等待，避免引入第二套错误契约。

### 12.3 响应

单次检测：

```ts
{
  success: true,
  message: string,
  tooltype: 'detect_captcha',
  data: {
    action: 'detect',
    assessment: CaptchaAssessment,
  },
}
```

等待：

```ts
{
  success: true,
  message: string,
  tooltype: 'detect_captcha',
  data: {
    action: 'wait_for_clear',
    assessment: CaptchaAssessment,
    wait: {
      cleared: boolean,
      elapsedMs: number,
      checks: number,
    },
  },
}
```

`success` 只表示工具调用是否成功完成。检测到 CAPTCHA 仍然是 `success: true`；等待超时也仍然是 `success: true`、`wait.cleared: false`。

工具通过 `context.getSelectedPage()` 获取页面。未选择页面时返回：

```ts
{
  success: false,
  message: '未选中页面，请先使用 select_page 选择目标页面。',
  tooltype: 'detect_captcha',
}
```

## 13. 错误处理

- URL、标题或 DOM 快照任一关键读取失败时，单次评估失败；不得用空值拼出假阴性结果。
- 工具使用现有浏览器错误规范化能力，把页面关闭、浏览器断开和执行超时转换为可操作消息。
- 规则匹配自身必须是纯函数，不吞掉编程错误。
- `document.body` 缺失不是错误，按空文本处理。
- 没有候选元素不是错误，正常返回 `not_detected`。
- 等待超时是正常结果；页面关闭、连续导航异常或非瞬时读取错误才是失败。
- 工具 handler 捕获模块错误后返回 `success: false`，不泄露堆栈、页面正文或凭据。

## 14. 安全、隐私与性能

### 14.1 只读保证

- 不调用 `click`、`fill`、`dragTo`、`dispatchEvent` 或页面内写操作。
- 不保存文件、截图或任务 artifact。
- 不访问网络、AI 或第三方资源。
- 不注册长期事件监听器、后台 interval 或 browser init script。

### 14.2 隐私保证

- 不采集表单值、存储、Cookie 或完整 HTML。
- 页面正文只在进程内用于规则匹配，不写日志、不放入结果。
- 证据只返回固定规则摘要和受限结构信息。
- 错误日志不附带页面快照。

### 14.3 资源边界

- 每次评估最多一次 DOM `evaluate`。
- 文本、候选元素、字段长度和证据数量均有固定上限。
- 规则是静态正则和选择器，不新增依赖。
- 检测器无缓存，不产生跨页面陈旧状态。

## 15. 测试策略

测试使用 Node 内置 `node:test` 和独立构造的 Patchright `Page` 桩。测试只断言公共行为，不复制参考仓库 fixture，也不为了覆盖率暴露私有生产方法。

### 15.1 模块检测测试

必须覆盖：

1. 可见 widget 结构产生强 DOM 证据并返回 `detected`。
2. 可见 slider 只有同时满足挑战标识和交互语义时才返回 `detected`。
3. 可见 CAPTCHA 图像结构返回 `kind: 'image'`。
4. 浏览器检查结构返回 `kind: 'browser_check'`。
5. 单个泛化 URL、标题或文本来源只返回 `suspected`。
6. 两个独立正向来源且无排除时返回 `detected` 和置信度 85。
7. 三个独立来源返回置信度 90。
8. OTP、邮箱码、账户验证和 2FA 文案返回 `not_detected` 或把弱正向结论降为冲突的 `suspected`。
9. 排除文案与强 DOM 证据同时存在时，强 DOM 仍返回 `detected`。
10. 隐藏候选、普通轮播、进度条和 range 控件不误报。
11. `document.body` 缺失时不崩溃。
12. URL、标题、正文、候选和证据遵循数量与长度边界。
13. 结果不包含正文、输入值、存储或站点键值。
14. 证据去重、排序、类型和建议稳定。
15. URL、标题或 DOM 读取失败时抛出，不返回 `not_detected`。
16. 单次评估超过 5,000 ms 时失败，且内部超时计时器得到清理。

### 15.2 等待测试

必须覆盖：

1. 初始 `not_detected` 立即清除。
2. 单次 `not_detected` 后重新出现挑战时不清除。
3. 连续两次 `not_detected` 后清除。
4. `suspected` 与 `detected` 都重置连续清除计数。
5. 超时返回 `cleared: false`、最后评估、耗时和检查次数。
6. 瞬时导航错误最多重试三次，并在成功后重置错误计数。
7. 第四次连续瞬时错误失败。
8. 页面关闭和非瞬时错误立即失败。
9. 测试结束后无遗留计时器。

### 15.3 工具测试

必须覆盖：

1. 工具名称、`ToolCategory.PAGES` 和 `readOnlyHint: true`。
2. page manifest、page index 与生成工具索引注册，且生成索引中恰好出现一次 `detectCaptcha`。
3. 未选择页面时返回明确失败。
4. `detect` 默认值与响应形状。
5. CAPTCHA 被检测到时工具仍返回 `success: true`。
6. `wait_for_clear` 返回 `wait.cleared`、`elapsedMs` 和 `checks`。
7. 等待超时仍是成功的领域结果。
8. 模块错误转换为 `success: false`，且消息不包含敏感快照。
9. `timeout` 拒绝小数、小于 1,000 或大于 300,000 的值。

### 15.4 变异检查

测试至少能捕获以下真实回归：

- 把单一弱信号错误提升为 `detected`；
- 删除 OTP 排除分支；
- 让排除证据覆盖强 DOM；
- 把 `suspected` 当作已清除；
- 连续清除次数从两次退化为一次；
- 页面读取失败被吞成 `not_detected`；
- 把正文或站点键值放入响应。

## 16. 验证闭环

实现完成后，以最终差异为边界依次运行：

1. 新增模块和工具的聚焦单元测试。
2. `npm run build:index`，并确认只产生预期的 `detectCaptcha` 生成索引差异。
3. `npm run typecheck`。
4. `npm run test:unit`。
5. `npm run check-format`。
6. 若仓库覆盖率命令可用，确认新增模块相关覆盖率不低于 80%；否则使用项目现有覆盖率采集方式记录无法自动证明的边界。

任一检查失败后，只修复与本任务相关的原因，并在最后一次代码修改后重跑同一检查。修改前的通过结果不能作为最终证据。

最终差异检查必须确认：

- `src/modules/captcha/`、`src/tools/page/detectCaptcha.ts` 和对应测试中没有 `open-source/jshookmcp` 或上游包引用；
- `src/tools/generated-tools-index.ts` 由生成器更新，且只增加本任务对应的 page 工具项；
- 没有 AI、截图、文件写入、自动输入、浏览器模式切换、启动脚本或 eager CDP 调用；
- 没有新增依赖；
- 没有修改 `build/`；
- 没有纳入用户已有的 debugger、worker、browsercli 等未提交修改。

## 17. 完成标准

只有同时满足以下条件才能报告迁移完成：

- 公共模块契约和 `detect_captcha` 工具契约与本规格一致；
- 规则能够区分明确 CAPTCHA、弱信号和常见账户验证误报；
- 等待状态机能稳定确认清除，不把页面错误当作清除；
- 输出符合只读、隐私和有界资源要求；
- clean-room 和许可证边界得到遵守；
- 新模块相关覆盖率达到 80%；
- 聚焦测试、类型检查、完整单元测试和格式检查均基于最终代码通过；
- 无剩余任务内阻塞项。

## 18. 已批准决策

- 只迁移被动检测、评估和等待清除，不迁移自动求解。
- 交付内部模块和一个只读 MCP 工具。
- 采用纯规则方案；模块自身不调用 AI。
- 使用当前已选页面，不创建或重启浏览器。
- 顶层 DOM + iframe 元数据是首版明确边界。
- 强 DOM 或两个独立来源形成确定检测；排除证据抑制弱误报。
- `wait_for_clear` 要求连续两次 `not_detected`。
- 等待超时是成功的领域结果，页面错误是工具失败。
- 不新增依赖、RuntimeServices 服务、工具分类或后台运行时行为。
