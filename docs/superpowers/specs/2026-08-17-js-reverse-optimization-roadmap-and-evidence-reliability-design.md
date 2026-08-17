# 逆向工具链可靠性与 JSVMP 优化设计（第二期）

> 状态：已批准（Brainstorming 完成） · 日期：2026-08-17 · 来源：`docs/optimization/js-reverse-optimization-report2.md`（基于 match/18 实战复盘） · 交付方式：总路线图 + 阶段 1 详细设计

---

## 1. 摘要与背景

在 `match.yuanrenxue.com/match/18`（JSVMPZL 魔改 MD5）实战中，暴露了 10 项涉及 **Skill 方法论** 与 **项目运行时/工具链** 的问题。

本设计基于 **能力依赖路线** 建立总路线图，并对首个子项目 **阶段 1：证据获取可靠性（P2/P3）** 展开可直接落地的完整架构设计：

1. **总路线图（覆盖全部 10 项）**：分为 5 个清晰阶段（阶段 0 现状校准 → 阶段 1 证据可靠性 → 阶段 2 VM 检测 → 阶段 3 运行时稳定性 → 阶段 4 方法论与交互）。
2. **阶段 1 核心交付**：
   - 彻底修复 `get_script_source --filePath` 保存完整性，提供字节完整落盘与校验（P2）。
   - 引入向后兼容的 `ScriptLocator` 机制，在页面导航/刷新导致 CDP `scriptId` 变化后自动重新定位（P3）。
3. **关键边界与原则**：
   - 保留现有 `scriptId` 顶层参数和快速路径，不破坏现有调用方。
   - 所有完整性与重定位逻辑下沉到工具/模块层，不引入额外的常驻内存数据库。
   - 遵守仓库规范，经过用户明确授权与例外确认，采用真实样本进行精确的单行长文本回归验证。

---

## 2. 十项问题总路线图与依赖关系

```text
[阶段 0: 现状校准 (HEAD 状态复核)]
        │
        ▼
[阶段 1: 证据获取可靠性 (P2 / P3)] ───► 解决样本截断与刷新失效，为后续阶段提供干净输入
        │
        ▼
[阶段 2: VM 检测准确性 (S1)]       ───► 基于完整 67.js 扩展 for 循环与特征簇识别
        │
        ▼
[阶段 3: 运行时稳定性 (P1 / P4)]   ───► 统一 evaluate 错误分类与 session 生命周期治理
        │
        ▼
[阶段 4: 方法论与交互 (S2-S5 / P5)] ───► 补齐 Skill 探针决策链，评估扩展真实轨迹工具
```

### 2.1 阶段规划与退出条件

| 阶段 | 对应问题项 | 职责与交付目标 | 退出验收门槛 |
|---|---|---|---|
| **阶段 0** | 全部 10 项现状 | 在当前分支 HEAD 上重跑验证，校准每个问题的真实状态（Open / Resolved / Partial）。 | 产出状态校准清单，消除“已在历史提交中修复但仍列为待办”的冗余开发。 |
| **阶段 1** | **P2**（保存截断）<br>**P3**（scriptId 动态失效） | 1. 确保 34KB+ 单行脚本落盘 100% 完整，提供 SHA-256 与字节校验。<br>2. 引入 `ScriptLocator`，刷新后根据 URL/DOM/Hash 自动重解析脚本。 | 1. 34498 字节 `67.js` 落盘无截断，哈希完全一致。<br>2. 模拟刷新场景下，旧 locator 能自动重定向到新 `scriptId`。<br>3. 纯 `scriptId` 旧调用不回归。 |
| **阶段 2** | **S1**（jssvmzl 漏检） | 扩展 `analyze_jsvmp_vm` 和 `JSVMPDeobfuscator`，支持 for 循环分派、函数表数组与特征串（`jssvmzl`、`md5_ff` 等）。 | `67.js` 返回 `isJsvmp: true` 且非 null；既有 while-switch 测试用例零回归。 |
| **阶段 3** | **P1**（evaluate 超时）<br>**P4**（Session 堆积） | 1. 细化 `evaluate_script` 错误分类（区分调试器暂停、页面无响应与语法错误）。<br>2. `newPage` / `BrowserContextProvider` 增加上限保护与陈旧会话回收。 | 1. evaluate 超时明确报告根因与建议。<br>2. 持续创建 100+ 页面时，已关闭页面与陈旧会话被自动剔除。 |
| **阶段 4** | **S2-S5**（Skill 路径）<br>**P5**（鼠标轨迹工具） | 1. 在 `SKILL.md` 中补齐运行时探针、参数反推、物理交互与 UA 反爬指导。<br>2. 评估 `click_at` 现有能力，必要时封装轻量级 `mouse_trace`。 | 1. Skill 包含完整逆向决策树与代码模板。<br>2. 真实轨迹校验用例通过。 |

---

## 3. 阶段 1 详细设计：证据获取可靠性（P2 / P3）

### 3.1 核心组件与职责划分

| 模块 | 文件位置 | 职责与公开接口 | 隐藏的实现细节 |
|---|---|---|---|
| **`ScriptResolver`** | `src/tools/shared/scriptResolver.ts`（新建） | 统一解析脚本定位信息：<br>`resolveScript(context, params: ScriptLookupParams): Promise<ResolvedScript>` | 匹配优先级、URL 模糊/精准匹配、DOM 序号对比、SHA-256 哈希比对、多候选冲突诊断 |
| **`getScriptSource` 工具** | `src/tools/script/script.ts` 与 `src/tools/debugger/index.ts` | MCP 工具入口，处理输入参数并返回元数据与预览：<br>`get_script_source` | 参数校验、调用 `ScriptResolver`、调用文件写入工具、组装结构化响应 |
| **`SafeScriptWriter`** | `src/utils/fsSafe.ts` / 扩展 | 安全原子写盘：<br>`writeScriptFileAtomic(filePath, content): Promise<WriteResult>` | 临时文件写入（`.tmp`）、落盘字节数对比、SHA-256 校验、原子重命名（rename） |

### 3.2 定位器协议（`ScriptLocator`）与数据结构

为了在导航刷新后仍能重新定位脚本，在现有参数基础上扩展 `locator` 结构：

```typescript
export interface ScriptLocator {
  /** 关联的稳定页面 ID（如 page-1） */
  pageId?: string;
  /** 脚本 URL（完整路径或相对路径） */
  url?: string;
  /** 内联脚本在 DOM 中的索引序号（从 0 开始） */
  domIndex?: number;
  /** 源码 SHA-256 哈希值 */
  contentHash?: string;
  /** 源码预期字节大小 */
  sourceLength?: number;
}

export interface ScriptLookupParams {
  /** 既有快速路径：当前调试会话内的 scriptId */
  scriptId?: string;
  /** 增强路径：跨刷新/跨会话的脚本定位器 */
  locator?: ScriptLocator;
}

export interface ResolvedScript {
  scriptId: string;
  url: string;
  source: string;
  sourceLength: number;
  sha256: string;
  matchedBy: 'scriptId' | 'hash' | 'domIndex' | 'url';
  staleScriptIdRecovered?: boolean;
}
```

### 3.3 数据流与解析匹配策略

```text
调用请求: { scriptId?: string, locator?: ScriptLocator, filePath?: string }
   │
   ▼
[1. 页面上下文检查] ──► 从 context 获取目标 Page (通过 locator.pageId 或当前选中页)
   │
   ▼
[2. 快速路径尝试] ────► 若提供了 scriptId，检查当前 DebuggerManager 中是否存在且有效
   │                    ├── 有效: 直接提取源码，进入落盘与响应阶段
   │                    └── 无效: 标记为陈旧 (Stale)
   │
   ▼
[3. Locator 重解析] ──► 若 scriptId 无效或未提供，但提供了 locator:
   │                    ├── 3.1 获取目标页面当前所有的 Script 列表
   │                    ├── 3.2 优先匹配 contentHash（若已抓取过或已缓存）
   │                    ├── 3.3 匹配 url + domIndex
   │                    └── 3.4 仅匹配 url
   │
   ▼
[4. 候选冲突判定] ────► 检查匹配结果数量:
   │                    ├── 0 个: 抛出 SCRIPT_NOT_FOUND (附带重载建议)
   │                    ├── 1 个: 成功命中新 scriptId，标记 staleScriptIdRecovered=true
   │                    └── >1 个: 抛出 SCRIPT_LOCATOR_AMBIGUOUS (返回所有候选供选择)
   │
   ▼
[5. 完整源码落盘] ────► 若传入了 filePath:
   │                    ├── 5.1 写入同目录临时文件 .<filename>.<pid>.tmp
   │                    ├── 5.2 校验落盘文件大小 === source.length
   │                    ├── 5.3 校验落盘文件 SHA-256 === 内存 source SHA-256
   │                    └── 5.4 原子替换重命名为目标 filePath
   │
   ▼
[6. 组装响应] ────────► 返回成功状态、完整 sourceLength、落盘路径、SHA-256、生成的 locator
```

---

## 4. 错误分类与防御设计

复用仓库既有的 `ErrorCodes` / `ToolError` 体系，定义清晰的错误码与用户可操作的引导建议：

| 错误场景 | 错误码 / 标识 | 错误信息示例 | 可操作引导建议（suggestion） |
|---|---|---|---|
| **页面已失效** | `PAGE_NOT_FOUND` | `目标页面 page-2 已关闭或不存在` | `请调用 list_pages 重新确认当前可用的活跃页面` |
| **旧 ID 失效且无 Locator** | `SCRIPT_ID_STALE` | `scriptId '67' 在页面刷新后已失效` | `页面刷新后 CDP scriptId 会重新分配。请提供 locator 参数或调用 list_scripts 重新获取` |
| **Locator 未匹配到脚本** | `SCRIPT_NOT_FOUND` | `未在页面中找到符合 locator 条件的脚本` | `请确认页面加载已完成（domcontentloaded），或放宽 locator 匹配条件` |
| **Locator 命中多个候选** | `SCRIPT_LOCATOR_AMBIGUOUS` | `定位器匹配到 3 个同名脚本: ID [72, 75, 81]` | `请补充 domIndex 或 contentHash 缩小范围` |
| **写盘完整性校验失败** | `SOURCE_INTEGRITY_MISMATCH` | `文件写入不完整：预期 34498 字节，实际写入 2353 字节` | `磁盘写入发生截断，已自动回滚临时文件。请检查磁盘空间或写入权限` |
| **磁盘写入异常** | `SOURCE_WRITE_FAILED` | `无法写入目标文件路径: EACCES` | `请检查目标路径权限与目录是否存在` |

---

## 5. 测试矩阵与验收方案

### 5.1 阶段 1 自动化测试矩阵

| 序号 | 测试层级 | 测试文件 | 测试用例与行为断言 |
|---|---|---|---|
| 1 | **单元测试** | `tests/unit/tools/script/scriptResolver.test.ts` | 1. 验证 `scriptId` 快速路径直通。<br>2. 验证旧 `scriptId` 失效时，通过 `url + domIndex` 成功重新定位到新脚本。<br>3. 验证通过 `contentHash` 精确重新定位。<br>4. 验证多候选歧义时抛出 `SCRIPT_LOCATOR_AMBIGUOUS` 并列出选项。 |
| 2 | **单元测试** | `tests/unit/tools/debugger/getScriptSourceFilePath.test.ts` | 1. 使用真实 34498 字节 `67.js` 样本执行 `filePath` 落盘测试。<br>2. 断言落盘文件大小严格等于 34498 字节（无 2353 字节截断）。<br>3. 断言落盘文件的 SHA-256 与内存源完全一致。<br>4. 模拟写入中断场景，验证临时文件回滚。 |
| 3 | **集成测试** | `tests/integration/scriptSourceRecovery.integration.test.ts` | 1. 真实启动 Chromium，加载包含多个内联与外部脚本的页面。<br>2. 获取目标脚本并记录 `locator`。<br>3. 执行 `navigate_page(reload)` 模拟页面刷新（CDP scriptId 改变）。<br>4. 再次调用 `get_script_source`，断言使用旧 locator 成功取到刷新后的源码。 |
| 4 | **回归测试** | `npm run test:unit` & `npm run typecheck` | 验证现有 100+ 工具测试全部绿灯，无破坏性变更。 |

---

## 6. 后续演进与依赖（Transition to writing-plans）

本规格书通过后，将按下列顺序逐个进入 `writing-plans`：

1. **子项目 1（即刻执行）**：证据获取可靠性（P2 截断修复 + P3 脚本定位器实现）。
2. **子项目 2**：JSVMP 虚拟机检测器增强（S1 针对 jssvmzl 的 for 循环与特征签名扩展）。
3. **子项目 3**：运行时与资源稳定性治理（P1 evaluate 超时诊断 + P4 session 泄漏清理）。
4. **子项目 4**：逆向方法论文档与交互工具演进（S2-S5 探针决策树 + P5 轨迹支持）。
