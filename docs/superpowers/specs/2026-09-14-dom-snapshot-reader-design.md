# DOM 快照读取与点击可靠性设计

> 状态：已复核修订 · 日期：2026-09-14（修订） · 交付方式：一个总设计、两阶段实施 · 参考方式：Clean-room 行为改写

## 1. 摘要

本设计把「页面交互元素读取」和「元素点击落点」两件事从启发式 JS 提升为 CDP 原生数据源：

1. **DOM 快照读取层**：新增只读模块，单次 `DOMSnapshot.captureSnapshot` 产出扁平元素列表，基于 `parentIndex` 聚合子文本节点文本，替代 `find_clickable_elements` 当前的 `document.querySelectorAll('*')` + `getComputedStyle` 启发式。
2. **点击落点解析**：通过 Playwright ElementHandle 获取 CDP `objectId`，打通全定位器（CSS/role/text/xpath）；先确保 `scrollIntoViewIfNeeded` 滚入视口，再走 CDP 四层降级（`DOM.getContentQuads` → `DOM.getBoxModel` → `getBoundingClientRect` → JS click）抽成共享 helper，彻底解决被遮挡元素及视口外边缘误触问题。
3. **遮挡过滤**：阶段 2 在落点处直接通过原生 `document.elementFromPoint(x, y)` 快速判断最高层遮挡，消除 Node 侧繁重几何布尔运算。

不引入新依赖，不改变现有工具返回契约，不移植 browser-use 的紧凑 `[index]` 树与 watchdog 事件架构。

## 2. 背景与问题

### 2.1 可点击元素识别依赖脆弱的 JS 启发式

`src/tools/dom/findClickableElements.ts` 注入 40 行 JS，判定条件为：

```
tag === button || (tag === a && 有 href) || (input 且 type ∈ {button,submit})
|| 有 onclick 属性 || role === button || getComputedStyle.cursor === 'pointer'
```

覆盖不到的情况：

- Vue/React/Angular 通过 `addEventListener` 绑定的点击（无 `onclick` 属性，`cursor` 常为默认值）。
- Shadow DOM 内的交互元素：`document.querySelectorAll` 不穿透 shadow root。
- ARIA 驱动的自定义控件（`role=menuitem/tab/checkbox` 等）。
- iframe 内文档（同一调用拿不到跨 frame 元素）。

`DOMInspector.findClickable()`（`src/modules/collector/DOMInspector.ts:263`）是同一套逻辑的第二份实现，问题相同。

### 2.2 点击落点只取包围盒中心，会被遮挡元素骗到

`click_at` 的两份实现都只用 `getBoundingClientRect()` 中心：

- `src/tools/input/clickAt.ts`
- `src/modules/collector/PageInteraction.ts:45`（由 `PageController.clickAt` 委托）

被弹窗、浮层、固定导航栏覆盖的元素，其包围盒中心落点实际命中的是上层元素。CDP 的 `DOM.getContentQuads` 能返回元素的实际可见四边形，选「视口内面积最大的可见 quad」比几何中心可靠。

## 3. 目标与非目标

### 目标

- 交互元素识别的数据源改为 CDP 快照的 `isClickable`、`cursor`、`computedStyles`。
- 天然穿透 open/closed shadow DOM，并标注 shadow 边界。
- open shadow 与 iframe 内元素可被读出（iframe 为 best-effort，见 §10）。
- 点击落点按四层降级解析，优先视口内最大可见 quad，且支持所有定位器（CSS/role/text/xpath/nth）。
- 现有工具返回契约不变；现有测试仅换 mock。

### 非目标

- 不输出 browser-use 风格的紧凑 `[index]` 树，不新增按 index 定位的工具。
- 不移植 browser-use 的 watchdog / EventBus 架构（本项目已有 `EventBus` + `TargetSessionRouter`）。
- 不移植 site-specific 启发式（search 类名关键词、icon 尺寸 10–50px 等）。
- 不改变默认浏览器启动、Cloak、CDP 懒激活、零 JS 注入策略。
- 阶段 2 遮挡过滤不在 Node 侧手写复杂几何矩形差集算法，使用浏览器轻量原生判定。

## 4. 总体设计

### 4.1 架构

```
find_clickable_elements (工具)
  └─ SnapshotReader.read(page)               [新模块, src/modules/dom/]
        └─ 1 次 DOMSnapshot.captureSnapshot
        └─ 解析 (建立 parentIndex 文本聚合与 layoutIndex 映射) → 交互性/可见性判定 → SnapshotNode[]
  └─ 映射 SnapshotNode[] → ClickableElement[]   [契约不变]

click_at / PageInteraction.clickAt
  └─ resolveClickPoint(frame, selector)      [新共享 helper, src/modules/browser/]
        └─ frame.locator(selector) 先滚动入视口 (scrollIntoViewIfNeeded)
        └─ elementHandle.evaluate → getClientRects() 视口裁剪面积降序
        └─ elementFromPoint 遮挡探测，取首个未遮挡 rect 中心
        └─ 降级 getBoundingClientRect 中心
        └─ 降级 jsClick
```

> 修订（2026-09-15）：原设计经 `elementHandle._remoteObject().objectId` 走 CDP
> `DOM.getContentQuads` / `DOM.getBoxModel`。该访问器在 Patchright（Playwright 内核）
> 上不存在，实测 `typeof handle._remoteObject === 'undefined'`，整条 CDP 层在生产环境
> 恒被跳过。现改为页内原生几何 `getClientRects()` + `elementFromPoint`，同样支持全部
> 定位器（handle 已由 locator 解析），且省去每次点击的 CDP session 往返。详见 §5.3。

### 4.2 数据流（find_clickable_elements）

```
page
 → withCdpSession(page, c => c.send('DOMSnapshot.captureSnapshot', {
       computedStyles: [display, visibility, opacity, cursor],
   }))
 → 解析 documents[].nodes + documents[].layout
 → 按索引对齐 nodes/layout，bounds 扣除 documents[].scrollOffsetX/Y
 → 逐个节点：isInteractive() && isVisible() → 生成 selector/text/type/visible/bbox
 → setStructuredContent({success, message, tooltype, data})
```

**Frame 作用域**：`DOMSnapshot.captureSnapshot` 走 page 级 session，返回所有 frame 的独立 document，而选择器与坐标都以外层文档为基准。因此仅当选中 Frame 为主 Frame 时走快照路径，选中子 Frame 时保持 `frame.evaluate` 的原有作用域；两条路径都不会混入其它 frame 的元素。

## 5. 组件设计

### 5.1 SnapshotReader（新模块）

**位置**：`src/modules/dom/SnapshotReader.ts`

**职责**：读一次快照，产出扁平 `SnapshotNode[]`。不做 IO 之外的决策，不返回给 LLM 的原始结构。

**接口**：

```ts
interface SnapshotNode {
  backendNodeId: number;
  tagName: string; // 小写
  attributes: Record<string, string>;
  text: string; // textValue/inputValue 或直接文本子节点
  isVisible: boolean;
  isInteractive: boolean;
  bounds?: {x: number; y: number; width: number; height: number}; // 视口坐标
  cursor?: string;
  shadowRootType?: 'open' | 'closed' | 'user-agent';
  computedStyles: Record<string, string>;
  inIframe: boolean;
}

async function readSnapshot(page: Page): Promise<SnapshotNode[]>;
```

**解析要点**：

- `documents[].nodes` 是列式存储：`nodeName` / `backendNodeId` / `nodeType` / `parentIndex` / `attributes`（扁平 name,value 对）按索引对齐，字符串表为顶层 `strings`。
- `layout` 通过 `nodeIndex` 对齐 `nodes`，提供 `bounds`、`styles`。**必须预建 `nodeIndex → layoutIndex` 映射**，否则退化为 O(n²)。
- **坐标系**：`layout.bounds` 与 `documents[].scrollOffsetX/Y` 同为文档坐标，`bounds` 必须扣除所属文档的滚动偏移后才能作为视口坐标输出（与 `getBoundingClientRect()`、`Input.dispatchMouseEvent` 一致）。Chromium 实测 `deviceScaleFactor: 2` 下 bounds 仍为 CSS 像素，不做 DPR 除法。
- **请求参数只保留实际消费项**：`computedStyles` 仅请求 `display` / `visibility` / `opacity` / `cursor`；`includePaintOrder` / `includeDOMRects` 会额外返回 `paintOrders` 与三组矩形，当前无消费方，徒增重站点快照体积，故不开启。
- `shadowRootType` 非空的节点为 shadow host；快照本身已包含 shadow 内容，无需额外遍历。
- **文本提取**：DOM 快照中元素节点自身的 `nodeValue` 通常为 null，文本位于子文本节点（`nodeType === 3`）。解析时必须通过 `parentIndex` 树状结构将子文本节点的文字聚合给祖先交互元素（如 `<button><span>确定</span></button>`）；表单控件优先提取 `inputValue` / `textValue`。

**交互性判定**（按代价从低到高，命中即返回）：

1. 快照 `isClickable === true`（CDP 已包含 JS 事件监听与原生可点击的 anchor）。
2. `cursor === 'pointer'`。
3. `a` 需带 `href`（无 href 的锚点不可点击，与 JS 降级路径口径一致）。
4. tag 白名单：`button` / `input` / `select` / `textarea` / `details` / `summary` / `option` / `optgroup`。
5. 属性：存在 `onclick` 等事件属性，或 `role` ∈ 交互 role 集合，或 `tabindex`。

> 修订（2026-09-15）：原判定表包含 `row` / `cell` / `gridcell` role，会让表格每一格都入选，噪声过大，已从交互 role 集合移除。

**可见性判定**：`input[type=file]` 例外放行（框架常以 `opacity:0` 隐藏原生控件）；其余为 `display !== 'none'` && `visibility !== 'hidden'` && `opacity !== '0'` && bounds 面积 > 0。

**敏感字段**：`password` / `file` / `hidden` 类型与 `autocomplete` 前缀 `cc-`、`one-time-code` 的属性值一律剔除；此外，**敏感元素的后代文本节点同样遮蔽**——`<textarea autocomplete="one-time-code">123456</textarea>` 的服务端渲染内容在快照里是独立文本节点，自身没有 attributes，只按自身属性判定会原样泄出。

### 5.2 find_clickable_elements 换源

**位置**：`src/tools/dom/findClickableElements.ts`

- handler 通过 `frame.page()` 取 Page，调 `SnapshotReader.read(page)`（仅主 Frame，见 §4.2）。
- `filterText` 过滤在扁平化后按 `text` 做不区分大小写包含判断，语义不变。
- selector 生成：id / class 一律输出属性选择器（`[id="…"]` / `[class~="…"]`）并对引号、反斜杠转义，避免 React `useId()` 的 `:r0:` 或 Tailwind 的 `hover:bg-x` 产生非法选择器；两者都没有时回退到 `tag`（shadow 内元素同样走 tag 兜底，不做 CSS 穿透选择器，作为已知限制）。
- iframe 内节点（`inIframe`）不输出：其 bounds 在自身文档坐标系中，选择器也无法在外层文档解析。
- 可见性口径与 JS 降级路径一致：**不可见元素同样返回**并由 `visible` 字段标记，不做隐式过滤。
- 返回字段与 `ClickableElement` 契约**完全一致**，调用方零改动。

**回退**：`readSnapshot` 抛错（CDP 不支持 / 页面销毁）时，保留现有 JS 注入路径作为 fallback，`logger.debug` 记录原因，并在 `message` 中标注降级。

`DOMInspector.findClickable()` 暂不改动（见 §10.3）。

### 5.3 点击落点解析（共享 helper）

**位置**：`src/modules/browser/clickPoint.ts`

**动机**：`click_at` 存在两份独立实现，只修一处会留下同类 bug。按根因修复原则，逻辑收敛到一个 helper，两处都调；同时打通全定位器支持与视口防偏。

```ts
type ClickSource = 'clientRects' | 'boundingRect';

type ClickResolution =
  | {
      kind: 'point';
      x: number;
      y: number;
      source: ClickSource;
      quadCount: number;
    }
  | {kind: 'jsClick'};

async function resolveClickPoint(
  frame: Frame,
  selector: string, // 支持 CSS / role= / text= / xpath= / >> nth=
): Promise<ClickResolution>;
```

**关键机制与降级链**：

1. **必须先滚动入视口**：通过 `const locator = frame.locator(selector); await locator.scrollIntoViewIfNeeded();` 确保元素处于可视区。若跳过此步直接取坐标，长页面底部元素被 clamp 截断会导致误触视口边缘空白或错误组件。
2. **获取 ElementHandle**：`const handle = await locator.elementHandle();`。handle 已由 locator 解析，因此原生支持所有 Playwright 定位器（CSS / role= / text= / xpath= / >> nth=），不需要额外的 `objectId`。
3. **页内提取可见 rect**：`handle.evaluate` 内执行 `el.getClientRects()`，过滤零面积 rect，按**与视口交集面积**降序排序，取第一个未被遮挡者的中心。视口在页内取 `window.innerWidth/innerHeight`（与 CDP `Input.dispatchMouseEvent` 同为 CSS 像素坐标系，无需额外 CDP 往返）。
4. **遮挡探测**：对候选中心调用 `document.elementFromPoint(x, y)`，未遮挡判定为 `topEl === null || el === topEl || el.contains(topEl)`。
5. **降级 boundingRect**：rect 为空或上述探测整体失败时，`handle.evaluate(el => el.getBoundingClientRect())` 取中心点；**零面积 rect 视为无效落点**，直接转入 jsClick，否则会点到视口左上角。
6. **最终降级 jsClick**：仍无法取得有效坐标时返回 `{kind: 'jsClick'}`，由调用方决定是否直接调 `locator.click()`。

每次降级失败均以 `logger.debug` 记录原因（含 selector），避免定位器语法错误、frame 脱离等真实故障被静默吞掉。

**接入点**：

- `src/tools/input/clickAt.ts`：所有定位器统一走 `resolveClickPoint(frame, selector)`；`jsClick` 时回退 `locator.click()`。
- `src/modules/collector/PageInteraction.ts::clickAt`：改调 `resolveClickPoint(page.mainFrame(), selector)`，消除重复实现；返回契约 `{x, y, tag, text}` 不变，`tag`/`text` 改在点击**之前**用同一 locator 取（点击触发导航/卸载后取值会失败，且 raw locator 不能交给 `document.querySelector`）。

### 5.4 遮挡过滤（阶段 2）

在落点 `(x, y)` 坐标计算出来后，验证该点是否被其它顶层图层覆盖：

- **实现方式**：在元素的 `handle.evaluate` 内直接调用原生 `document.elementFromPoint(x, y)`，判断顶层元素是否是目标元素本身或其子节点（`el === topEl || el.contains(topEl)`）。**不采用** `topEl.contains(el)`——当目标 `pointer-events: none` 时它会误判为未遮挡。
- **优点**：无需在 Node.js 端手写复杂的 2D 矩形差集/并集（避免 O(n²) 与 5000 矩形上限隐患），完美处理 CSS 层叠上下文、透明度、圆角、transform 变换与遮挡。
- **结合**：若顶层命中元素不是目标节点，则尝试该元素的其余 rect；全部候选均被遮挡时回退面积最大者，不降级为 jsClick。

## 6. 错误处理与回退

| 场景                               | 行为                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `DOMSnapshot.captureSnapshot` 失败 | `find_clickable_elements` 回退 JS 启发式，`message` 标注降级                    |
| 快照缺 `layout` / 无 bounds        | 该节点 `isVisible=false`，不进入结果（file input 例外）                         |
| 页面在读取中途销毁                 | `withCdpSession` 吞 `Target closed` 类错误；工具返回空列表 + 降级提示           |
| quad 全部失败                      | 逐层降级至 `boundingRect` / `jsClick`，不抛错                                   |
| boundingRect 零面积                | 视作无效落点，直接降级 `jsClick`（避免点到视口左上角）                          |
| 快照体积过大                       | computedStyles 仅请求实际消费的四项，不开启 paintOrder / DOMRects；不设静默截断 |

## 7. 安全

- **密码字段值绝不进入输出**：`input[type=password]` 的 `value` / `valuetext` 属性一律剔除，防止提示注入通过 DOM 快照外泄。`file` / `hidden` 类型与 `autocomplete` 前缀 `cc-`、`one-time-code` 同样按敏感字段处理（值不输出）。敏感元素的**后代文本节点**同样置空，避免 `<textarea>` 一类容器的服务端渲染内容绕过按属性判定。
- 不新增外部依赖，不改变零 JS 注入策略；阶段 1 的读取为纯 CDP 只读路径。
- 快照仅在本进程内解析，不落盘、不上传。

## 8. 测试策略

覆盖目标 80%，全部为无浏览器单元测试（喂合成快照 JSON）。

| 文件                                                   | 断言                                                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/modules/dom/SnapshotReader.test.ts`        | 扁平化正确；`parentIndex` 子文本节点聚合；`isClickable`/cursor/tag/role/href 判定；可见性过滤；文档坐标 → 视口坐标换算；敏感字段（含后代文本）不出现 |
| `tests/unit/tools/findClickableElements.test.ts`       | 换 mock 为 CDP 快照；断言**旧返回契约不变**；选择器属性转义；回退路径                                                                                |
| `tests/unit/modules/browser/clickPoint.test.ts`        | 降级顺序；滚动入视口；选最大可见 rect；全定位器支持（CSS/text/role/xpath）；遮挡探测；零面积降级                                                     |
| `tests/unit/tools/input/clickAt.test.ts`               | 各类定位器走 rect；失败降级                                                                                                                          |
| `tests/unit/modules/collector/PageInteraction.test.ts` | 元数据在鼠标事件之前读取                                                                                                                             |

交付前运行：`npm run typecheck`、`npm run test:unit`、`npm run check-format`。

## 9. 分阶段实施

**阶段 1 · 分析层**

1. `src/modules/dom/SnapshotReader.ts` + 单测。
2. `find_clickable_elements` 换源 + 回退 + 测试改 mock。
3. 敏感字段剔除 + 单测。

**阶段 2 · 点击可靠性**

1. `src/modules/browser/clickPoint.ts` + 单测。
2. `click_at` 与 `PageInteraction.clickAt` 接入，消除重复实现 + 测试。
3. paint-order 遮挡过滤接入 + 单测。

## 10. 风险与限制

### 10.1 定位器与 Frame 覆盖

通过 Playwright `locator.elementHandle()` 拿到元素句柄后在元素所属 frame 内取几何，已支持全部定位器（CSS / role= / text= / xpath= / >> nth=）。已知限制为：极端情况下若元素已被 DOM 移除导致 handle 失效时，优雅回退到 `jsClick`。

### 10.2 iframe 覆盖为 best-effort

`captureSnapshot` 在 page 级 session 上返回各 frame 的独立 document，行为随 Chrome 版本而异。快照的 bounds 以**所属 document** 为基准，iframe 内节点的坐标在自身坐标系中，且由其生成的 CSS 选择器无法在外层文档解析，因此 `find_clickable_elements` 在快照路径排除 `inIframe` 节点；选中子 Frame 时整体走 `frame.evaluate` 降级路径。

### 10.3 DOMInspector.findClickable 的遗留处理

`DOMInspector.findClickable()` 在 `src/` 中除定义本身外无实际调用方。本设计在 `DOMInspector.ts` 中为其添加 `@deprecated` 注释，建议在阶段 1 交付完成后单开清理 PR 移除。

### 10.4 快照性能

重页面（2 万+ 元素）单次快照解析可能达数百毫秒。`nodeIndex` 映射与 rare data 的 set 化是避免 O(n²) 的必要措施（参考实现从 5.9s 降至 2ms）。若实测超时，需评估是否限制解析节点数并显式提示截断。

备注：Chromium 实测验证（在 `deviceScaleFactor: 2` 下，`getBoundingClientRect()` 与 `DOMSnapshot` `layout.bounds` 均返回 `[8, 8, 100, 50]`）快照返回的包围盒已是 CSS px，因此无需且不得对 bounds 做 DPR 除法。

### 10.5 硬编码交互 role / tag 集合会随站点演化

判定集合来自 CDP 语义与 ARIA 规范，属于通用规则；不接受 site-specific hack。新站点适配通过 `isClickable` 与 `cursor` 覆盖，不改判定表。

### 10.5 硬编码交互 role / tag 集合会随站点演化

判定集合来自 CDP 语义与 ARIA 规范，属于通用规则；不接受 site-specific hack。新站点适配通过 `isClickable` 与 `cursor` 覆盖，不改判定表。

## 11. 已决问题

| 问题                                  | 结论                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| 是否输出紧凑 `[index]` 树             | 否，只升级数据源                                                  |
| 是否移植 watchdog 架构                | 否，已有 EventBus                                                 |
| `click_at` 非 CSS 定位器              | 已打通，通过 `locator.elementHandle()` + 页内几何统一支持全定位器 |
| 视口外元素点击偏离                    | 统一增加 `scrollIntoViewIfNeeded` 保证落点正确                    |
| 遮挡过滤方案                          | 采用原生 `elementFromPoint` 代替复杂的 5000 矩形几何差集分解      |
| 是否删除 `DOMInspector.findClickable` | 阶段 1 标记 `@deprecated`，随后单独清理                           |
