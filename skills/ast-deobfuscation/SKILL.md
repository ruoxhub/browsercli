---
name: ast-deobfuscation
description: 使用 Babel AST 对 JavaScript 做分层、可回退的定向反混淆。适用于 `_0x` 标识符、字符串表、自执行解码包装、dispatcher 对象、虚假常量分支、`while/for + switch` 控制流平坦化、`if (literal === opcode)` 分发链，以及需要按站点或混淆家族命中特征切换专用脚本的场景。需要通过 browsercli 从页面定位、导出或运行时验证混淆脚本，以及用户明确提到 decodeObfuscator、reese84、顶象、极验4、同花顺、网易易盾、小红书、OB 变种或类似站点适配时也使用本 skill。
---

# AST 反混淆

优先使用分层入口，而不是继续把站点特有逻辑堆进通用脚本。

## 工作流

1. 输入来自浏览器页面时，先按 `references/browsercli-tools.md` 定位并导出目标脚本；已有本地 JS 文件时跳过此步。
2. 运行 `scripts/detect-patterns.js <input.js> [hint]` 做模式检测。
3. 只读取命中的站点或混淆家族规则文档。
4. 运行 `scripts/run-pipeline.js <input.js> <output-dir> [hint]` 执行选中的流水线。
5. 对照参考产物、BrowserCLI 运行时证据或原始混淆症状，判断是否还需要新增专用适配脚本。

## 设计规则

- 通用脚本只保留低风险、可复用的改写，例如结构标准化、虚假分支清理、dispatcher 内联、控制流拍平和 `if -> switch`。
- 一旦某个模式明显是站点特有的，就同时补齐四部分：规则文档、检测器命中项、专用适配脚本、流水线配置项。
- 对于高开销步骤，优先按家族跳过或重排，不要强行要求所有样本走同一套顺序。像 `reese84` 这种大样本，如果太晚执行 `inline-literals`，很容易卡住。
- 专用适配脚本应当保持窄而准。如果某条规则没有在多个无关样本中复用，不要急着回灌到通用脚本。
- 结构性改写后要重新 parse，并保证每一阶段都可以独立运行和排查。

## 入口脚本

- `scripts/deobfuscate.js`
  自包含一体化反混淆脚本。整合了通用解包（Packer / AAEncode / URLEncode）、十六进制/Unicode 字符串解码、字符串数组沙箱求值内联、AST 常量折叠与逻辑化简、虚假分支消除以及 while-switch 控制流拍平。支持单文件直接 CLI 执行（`node scripts/deobfuscate.js <input.js> [output.js]`）或模块导入。
- `scripts/detect-patterns.js`
  根据文件路径、可选 hint 和源码症状判断最可能命中的站点或混淆家族。
- `scripts/run-pipeline.js`
  把样本复制到测试目录，执行选中的步骤，记录耗时并输出流水线报告。
- `scripts/collect-residue-metrics.js`
  统计仍未解开的症状，例如 `split('|')`、直接 `loop/switch` 平坦化、opcode `if` 链、dispatcher wrapper 和 `_0x` 标识符。
- `scripts/decode-obfuscator-pass.js`
  安全移植 decodeObfuscator 的字面量、常量、循环块和对象预处理；不执行输入源码，也不启用基于文本特征的删代码逻辑。
- `scripts/strip-invisible-unicode.js`
  零宽不可见字符（Zero-width Unicode）隐写解码、清理以及 `String.fromCharCode` / `atob` 常量表达式折叠。
- `scripts/detect-obfuscator-types.js`
  综合混淆特征探测器，识别 JavaScript-Obfuscator、JSFuck、Packer、AAEncode、控制流平坦化、VM 保护及站点防护类型。
- `scripts/prune-opaque-predicates.js`
  消除数学与代数不透明谓词（数值比较、`x * 0 === 0`、`x - x === 0` 等恒等式），清理不可达死代码分支。
- `scripts/sandbox-evaluator.js`
  受控隔离的 Node.js `vm` 沙箱求值基础设施，支持前置 Prelude 语句自动执行与最小浏览器环境 Mock。
- `scripts/fold-wrappers.js`
  识别并就地折叠局部 Dispatcher 对象、二元/逻辑运算代理函数及多层嵌套包装器。
- `scripts/babelpack-enhancer-pass.js`
  BabelPack 深度增强流水线，包含 `keyToLiteral`、声明拆分、分散属性归并、反调试代码清理与 `callExpressToLiteral` 沙箱动态求值。
- `scripts/unpack-webcrack.js`
  集成 Webcrack 与 AST 兜底方案，对 Webpack / Browserify 等巨型 Bundle 进行自动化模块拆解、切分与落盘。
- `scripts/deobfuscate-vm-protection.js`
  虚拟机保护（VM Protection）结构识别、指令计数、组件提取与逆向分析报告生成。
- `scripts/deobfuscate-jsvmp.js`
  JSVMP 虚拟机专项反混淆分析，涵盖字节码数组、操作数栈、寄存器环境与 Dispatch 循环逆向。
- `scripts/analyze-jsvmp-vm.js`
  纯静态解剖 JSVMP 虚拟机骨架，提取 while-switch / index-dispatch 分派器结构、字节码数组来源、指令表空洞与 Opcode 语义分类，支持 `--json` 输出。
- `scripts/compare-with-reference.js`
  将最新流水线输出与 `decode.js` 对比，汇总剩余差距。

## 参考文档

- 从浏览器页面采集源码、补抓 Worker 脚本或验证运行时行为时，读 `references/browsercli-tools.md`，并使用 `browsercli` skill 获取完整命令契约。
- 新增或调整适配器时，先读 `references/pattern-layering.md`。
- 任何逻辑想放进通用脚本前，先读 `references/safe-rewrite-rules.md`。
- 处理字符串表、解码 stub、最小运行时求值时，读 `references/string-array-and-minimal-eval.md`。
- 需要理解 decodeObfuscator 兼容能力和 `eval` 安全边界时，读 `references/decode-obfuscator.md`。
- 深入 BabelPack AST 变换与动态求值时，读 `references/babelpack-enhancer.md`。
- 零宽字符与特殊编码清洗时，读 `references/invisible-unicode.md`。
- 混淆家族与加固手段全面特征检测时，读 `references/obfuscation-detector.md`。
- 处理数学、代数恒等式与死分支时，读 `references/opaque-predicates.md`。
- 使用安全隔离沙箱求值前置环境时，读 `references/sandbox-evaluator.md`。
- 处理对象 Dispatcher 与复杂代理函数折叠时，读 `references/wrapper-folder.md`。
- 进行 Webpack/Browserify 模块打包器拆包时，读 `references/webcrack-bundle-unpack.md`。
- 分析商业 VM 保护与解释循环时，读 `references/vm-protection.md`。
- 深度逆向与还原 JSVMP 虚拟机时，读 `references/jsvmp-deobfuscation.md`。
- 运用 LLM 大模型辅助代码清洗、语义命名推导、VM 结构分析与思维链去虚拟化时，读 `references/llm-deobfuscation-prompts.md`。
- 处理控制流平坦化、opcode 分发器和 VM 类 handler 时，读 `references/control-flow-and-opcode-patterns.md`。
- 处理逗号表达式、IIFE、语句提升时，读 `references/sequence-normalization.md`。
- 检测器命中后，只读取对应的一份站点规则文档：
  - `references/patterns/reese84.md`
  - `references/patterns/dingxiang.md`
  - `references/patterns/geetest4.md`
  - `references/patterns/tonghuashun.md`
  - `references/patterns/yidun.md`
  - `references/patterns/xiaohongshu.md`
  - `references/patterns/cn-bidding-ob.md`
  - `references/patterns/mps-ob.md`

## 校验

- 每个新增或改过的 JavaScript 辅助脚本，在接入流水线前都要至少过一次 `node --check` 或等价的加载校验。
- 修改 skill 后，运行 `C:\Users\25198\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\25198\.codex\skills\ast-deobfuscation`。
- 测试案例时，把中间产物、检测结果、对比结果和流水线耗时都保留在案例目录里，方便定位慢步骤和失败步骤。
