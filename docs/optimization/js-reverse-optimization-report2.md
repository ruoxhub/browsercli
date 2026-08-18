# js-reverse 工具问题分析与优化建议（第二期）

> 基于猿人学 match/18（JSVMPZL 魔改 MD5）逆向实战的复盘
> 日期：2026-08-17

---

## 一、目标与边界

本文档只记录 match/18 实战中实际遇到、已复现或已定位的问题，并给出最小优化建议。

**背景**：

- 目标：`match.yuanrenxue.com/match/18`，等价于网洛者第 7 题 JSVMPZL，本质是魔改 MD5（`md5_ff/gg/hh/ii`，其中 `md5_hh` 两个默认值被修改）。
- 问题分两层：`jsvmp-reverse` skill（5 项）+ Reverser-CLI 项目（5 项）。

**已落盘的证据**：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `67.js` | 34498 字节 | jssvmzl VM 完整源码（本次漏检对象） |
| `49/50/54/55/56/58/69.js` | 各 2353 字节 | `get_script_source` 截断的受害者 |

**不做假设**：

- 不把 jssvmzl 的特征推导为所有 JSVMP 变体的特征。
- 不新增大功能，除非它能修复当前链路中的明确断点。

---

## 二、Skill 层

### S1（P0）`analyze_jsvmp_vm` 漏检 jssvmzl 型 VM

**现象**：`analyze_jsvmp_vm --scriptId 67` 返回 `isJsvmp: false`；`JSVMPDeobfuscator` 同样漏检。

**根因（已实测确认，两处检测点各自独立）**：

实测 `67.js` 的 AST：**0 个 while、0 个 switch、17 个 for 循环**。

1. `JSVMPDeobfuscator.detectJSVMP`（`src/modules/deobfuscator/JSVMPDeobfuscator.ts:234`）：
   判定式为 `hasSwitch && (hasInstructionArray || hasProgramCounter) && ...`，而 `hasSwitch` 硬要求 `SwitchStatement.cases.length > 10`。jssvmzl 无大 switch → `hasSwitch` 恒为 false → 永远返回 null。
2. `analyze_jsvmp_vm.findDispatcher`（`src/tools/jsvmp/analyzeVm.ts:204`）：
   只识别 `while(true)`、大 `switch`、特定 `CallExpression` 取指形态（`callee.property.property` 为 `++`），**不识别 for 循环解释器**；`findBytecodeAndTable` 又要求 `var X = [func...]` 字面量（50% 函数元素）。jssvmzl 用 for 循环 + 非字面量函数表分派，两个信号都吃不到，置信度停在 0.4 < 0.6 阈值 → false。

> 注意：正确修法不是「降低 switchCount 阈值」，而是新增 for 循环分派识别 + 特征串签名。方向错了会白改。

**最小修复建议**：

- `findDispatcher` 把 `ForStatement` 循环纳入分派容器信号；把「取指自增表达式 + 指令表函数数组」独立作为分派信号，不再强制要求 switch/while。
- 增加 VM 特征串签名识别：`jssvmzl`、`__TENCENT_CHAOS_VM`、`md5_ff/md5_gg/md5_hh/md5_ii`、`__v/__V/__y` + `Vy_` 这类 jssvmzl 命名簇。
- `JSVMPDeobfuscator.detectJSVMP` 移除硬 `hasSwitch` 门槛，补一条「for 循环解释器 / 函数表分派 / 特征串」的降级判定路径。

**验收标准**：

- `analyze_jsvmp_vm` 对 `67.js` 返回 `isJsvmp: true` 且 `dispatcher.kind` 非空。
- `JSVMPDeobfuscator.detectJSVMP` 对 `67.js` 返回非 null。
- 原有 while-switch 型样本不回归（跑 `tests/unit/tools/jsvmp/analyzeVm.test.ts` + `tests/unit/modules/JSVMPDeobfuscator.test.ts`）。

---

### S2（P0）缺失「运行时解密产物捕获」路径

**现象**：VM 是字节码解释器，解密后的 `myenc`、`window.request` 等函数在运行时才出现，静态 AST 完全看不到。skill 的 P2/P3 只写了「抠代码 → 解密字节码 → 分派还原」，实战中真正有效的是运行时探针。

**修复建议**（补 `SKILL.md` P3）：

- 补充「运行时探针捕获解密产物函数」的方法：轮询 hook 全局函数（如 `window.myenc`）+ 记录调用栈定位 VM 内部调用者。
- 明确「字节码静态不可见时，先探针后还原」的决策顺序。

---

### S3（P1）缺失「从请求参数反推」的 Observe-first 步骤

**现象**：实战中 `t`/`v` 是通过观察成功请求 URL 参数发现的，而脚本 55 的 `m` 拦截器是刻意误导。skill P1 未强调先抓请求差异。

**修复建议**（补 `SKILL.md` P1）：

- 强调先抓成功/失败请求的 URL 差异（参数名/值/时机），再决定逆向方向。
- 提醒不要被页面代码里的参数名带偏（页面参数名可能是诱饵）。

---

### S4（P1）缺失「物理交互」要求

**现象**：`click_at`（真实 CDP 鼠标事件）产生合法轨迹是 VM 正常生成 token 的前提；`dispatchEvent` 模拟的 mousemove 被服务端拒绝。

**修复建议**（补 `SKILL.md` P4 探针部分）：

- 注明：对校验轨迹真实性的目标，必须用物理交互（`click_at` 等），JS 模拟（`dispatchEvent`）无效。

---

### S5（P2）缺失「参数级反爬」（UA/header 校验）

**现象**：第 5 页要求 UA=yuanrenxue。skill P5 环境判定只覆盖「浏览器环境依赖」，没覆盖「token 之外还需特定请求头/UA」的场景。

**修复建议**（补 `SKILL.md` P5）：

- 补充参数级反爬场景：除签名参数外还需特定 UA/header 时，纳入环境判定与复现脚本。

---

## 三、项目层

### P1（P1）`evaluate_script` 在 VM 劫持 XHR 后卡死/超时

**现象**：多次遇到 `Script execution timed out`。VM 把 `XMLHttpRequest.prototype.open/send` 换成解释器函数后，worker 内部依赖的 evaluate 通道受影响。

**根因**：待定位（`evaluate_script` 工具 + worker 内部评估通道的 XHR 依赖链）。

**最小修复建议**：

- `evaluate_script` 增加明确超时与错误分类（区分「页面卡死」与「执行错误」）。
- 或让 worker 内部评估通道不依赖被劫持的 XHR。

---

### P2（P0）`get_script_source --filePath` 保存截断

**现象**：34498 字节的 VM 只写入 2353 字节。仓库内 7 个脚本文件全部恰好 2353 字节，属系统性截断。

**根因**：待定位（`get_script_source` 的 worker 端保存逻辑）。

**最小修复建议**：

- 修复截断。
- 或返回 `sourceLength` 与文件实际大小不一致时告警。

---

### P3（P1）scriptId 动态变化导致工具链失效

**现象**：每次刷新后 scriptId 重新分配（57→67→…），`analyze_jsvmp_vm --scriptId`、`get_script_source --scriptId` 在导航后指向错误脚本。

**最小修复建议**：

- 支持按「页面 DOM script 索引 + 内容 hash」定位。
- 或工具在脚本 ID 失效时给出明确提示。

---

### P4（P2）Session 堆积

**现象**：实战中 Active Sessions 达到 100（每次 `new_page` 累积），影响后续操作。

**最小修复建议**：

- `new_page` 超过阈值时自动清理旧 session。
- 或提供批量清理命令。

---

### P5（P2）缺少「带真实轨迹的鼠标操作」工具

**现象**：`click_at` 内部产生了合法轨迹（实战恰好够用），但项目没有专门模拟完整轨迹序列的工具，对轨迹校验严格的目标会不够。

**最小修复建议**：

- 增加 `mouse_trace` 类工具，或在 `click_at` 文档中说明其轨迹行为。

---

## 四、优先级总览

| 优先级 | 项 | 层 | 类型 |
| --- | --- | --- | --- |
| P0 | S1 jssvmzl 漏检 | Skill | code |
| P0 | S2 运行时解密产物捕获 | Skill | doc |
| P0 | P2 脚本保存截断 | 项目 | bug-fix |
| P1 | S3 请求参数反推 | Skill | doc |
| P1 | S4 物理交互要求 | Skill | doc |
| P1 | P1 evaluate_script 超时 | 项目 | code |
| P1 | P3 scriptId 动态失效 | 项目 | code |
| P2 | S5 参数级反爬 | Skill | doc |
| P2 | P4 session 堆积 | 项目 | code |
| P2 | P5 mouse_trace 工具 | 项目 | new-tool |

**建议实施顺序**：S1 →（P2 插队，拿到干净样本的前置）→ S2/S3/S4/S5 文档一批 → P1 → P3 → P4 → P5。
