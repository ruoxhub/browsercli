# Reverse Workflow

这份文档是 **模型执行协议**，不是人类教程。

目标：把前端逆向任务统一约束成稳定阶段，避免跳步骤、凭记忆推进或在补环境未收敛时过早提纯算法。

## 适用范围

适用于以下任务：
- 请求签名、加密参数、风控参数定位
- 页面运行时采样
- 本地 Node 补环境复现
- 补环境通过后的纯算法提纯
- 提纯后的 Python / 其他宿主迁移

## 核心原则

- `Observe-first`
- `Hook-preferred`
- `Breakpoint-last`
- `Rebuild-oriented`
- `Evidence-first`
- `Pure-extraction-after-pass`

## 阶段总览

1. `Observe`
2. `Capture`
3. `Rebuild`
4. `Patch`
5. `PureExtraction`
6. `Port`

任何任务都应明确自己当前处于哪个阶段；没有阶段结论，就不应直接切到下一阶段。

---

## 1. Observe

### 目标
- 确认目标请求、关键脚本、候选函数、触发动作
- 建立任务边界，避免盲猜环境或直接补宿主

### 必做动作
- 确认目标请求 URL / 参数 / 响应特征
- 定位 initiator、候选脚本 URL、候选函数名或关键字符串
- 记录页面动作、触发条件与目标 `targetContext`
- 把关键观察写入 task artifact

### 禁止事项
- 还没确认目标请求就开始补环境
- 还没定位关键脚本就开始手翻混淆代码

### 完成判据
- 已能回答：目标请求是谁发起的、哪段脚本参与、页面上如何触发

---

## 2. Capture

### 目标
- 用最小侵入方式拿到运行时样本、参数、调用顺序和中间值

### 必做动作
- 优先使用 `hook` 或 preload hook
- 采样 fetch/xhr、候选函数、关键对象字段
- 尽量获取调用前后输入输出，而不是只抓最终结果
- 持续把样本写入 task artifact

### 禁止事项
- hook 不足时立刻切断点
- 一次性抓全部对象快照，导致噪音过大

### 完成判据
- 已有至少一条可复用的真实运行样本
- 已知道参数链路的最小调用序列

---

## 3. Rebuild

### 目标
- 把页面证据导出为本地可运行的 Node 复现工程

### 必做动作
- 导出 local rebuild bundle
- 固定入口、目标脚本、初始状态和必要 seed
- 在 `env/entry.js` 或等价入口上运行目标链路
- 记录当前运行失败点或首个可运行结果

### 禁止事项
- 没有页面证据就手写 `window/document/navigator`
- 直接用 Python `execjs` 开始补环境

### 完成判据
- 本地已有稳定复现入口
- 能看到当前运行错误或当前阶段输出

---

## 4. Patch

### 目标
- 按代理日志和 `first divergence` 驱动补环境，直到本地链路可运行且服务端验收通过

### 必做动作
- 优先读取代理 env log
- 先记录 `first divergence`
- 只补当前 `first divergence` 对应的最小因果单元
- 每轮补丁后立即复测
- 记录 `first divergence` 是否前移
- 至少拿到一次服务端验收通过

### 禁止事项
- 没有代理日志就补宿主
- 没有 `first divergence` 记录就连补多个对象
- 把补环境成功误当成纯算法已完成

### 完成判据
- 本地 env rebuild 已稳定跑通目标链路
- 已有一次服务端验收通过
- 已记录至少一条 `first divergence` 及其修复路径

### 下一阶段输入
- 稳定样本
- 已通过验收的 local rebuild
- 关键中间值与调用边界证据

---

## 5. PureExtraction

`PureExtraction` 不是补环境延长线，而是一个独立阶段。

详细协议见：`docs/reference/pure-extraction.md`

### 进入条件
- `Patch` 已完成
- 已有稳定样本、固定夹具候选、服务端验收记录

### 目标
- 把“环境噪音”与“算法输入”分开
- 先提纯 Node 可读纯算实现
- 形成稳定 fixture

### 禁止事项
- env rebuild 还没通过就开始翻 Python
- 还没区分输入边界就直接照抄页面对象

### 完成判据
- Node pure implementation 与 runtime fixture 对齐
- 已明确哪些值属于算法输入、哪些属于环境状态

---

## 6. Port

### 目标
- 把已提纯的 Node 纯算实现迁移到 Python 或其他宿主

### 必做动作
- 使用与 Node pure 相同夹具
- 逐段对齐输入、关键中间值与最终输出
- 保留外部语言调用边界说明

### 禁止事项
- 直接以页面 runtime 为真值源跳过 Node pure
- 没有 fixture 就直接改写为 Python

### 完成判据
- 外部语言版本与 Node pure 对齐
- 至少一条服务端验收通过

---

## 阶段切换规则

- 只有 `env rebuild` 跑通且服务端验收通过后，才允许进入 `PureExtraction`
- 只有 Node pure 已稳定后，才建议进入 `Port`
- 任一阶段出现不一致，应优先回退到最早出现分叉的阶段，而不是继续往后补

## 必备产物

最少应沉淀：
- 目标请求与脚本证据
- task artifact 中的 `targetContext`
- local rebuild 入口
- 代理 env log
- `first divergence` 记录
- runtime 样本
- pure fixture
- pure implementation
- 服务端验收记录

## 配套文档

- `docs/reference/env-patching.md`
- `docs/reference/pure-extraction.md`
- `docs/reference/reverse-artifacts.md`
- `docs/reference/reverse-update-prompt-template.md`
- `docs/reference/reverse-report-template.md`
- `docs/reference/algorithm-upgrade-template.md`
