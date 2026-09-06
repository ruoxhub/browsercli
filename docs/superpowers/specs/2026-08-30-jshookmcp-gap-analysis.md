# jshookmcp → Reverser-CLI 能力差距分析与分波路线

- **日期**：2026-08-30
- **状态**：差距分析（结论导向，供分波决策；非可执行实现 spec）
- **文档路径**：`docs/superpowers/specs/2026-08-30-jshookmcp-gap-analysis.md`
- **目标项目**：Reverser-CLI（proxycli）
- **上游参照**：`open-source/jshookmcp`（`@jshookmcp/jshook` v0.3.5，AGPL-3.0-only）
- **前序文档**：`2026-08-11-jshookmcp-migration-design.md`（SourceMap 首期，已交付）

---

## 1. 目的与定位

`2026-08-11-jshookmcp-migration-design.md` 只锁定了 SourceMap 一个域的 clean-room 迁移，其余域的
「分波路线」停留在 §6 的粗粒度方向。本文把 34 域逐一对照 Reverser-CLI 现状，产出一张**可复用的
判定决策表**（复用 / 补缺 / 排除），并给出下一波的**候选清单与优先级**，避免后续每开一个域都
重新做一次全量观察。

本文不复制 jshookmcp 任何实现细节，只基于域边界与工具面语义做能力级对齐（clean-room 边界与
`2026-08-11` 版 §5 一致）。

---

## 2. 规模与坐标对齐

| 维度   | jshookmcp                               | Reverser-CLI（proxycli）                    |
| :----- | :-------------------------------------- | :-------------------------------------------- |
| 工具数 | 668（`generated-tool-catalog.ts` 实测） | 157（`generated-tools-index.ts` 实测，29 域） |
| 域数   | 34                                      | 29 个工具目录 + 16 个 `src/modules/`          |
| 定位   | 广而全的安全研究军火库                  | 窄而深的 Web/JS 逆向工作台                    |
| 许可证 | AGPL-3.0-only                           | Apache-2.0                                    |
| 反检测 | 内置开源（rebrowser + stealth 脚本）    | 内置开源（Patchright 协议层，四层分层）       |

两侧「域」不是一一对应的同粒度单位（jshookmcp 的域是「能力族」，Reverser 的工具目录是「工具分组」），
故对齐按**能力面**而非按名字匹配。

---

## 3. 三分类判定标准

沿用 `2026-08-11` 版 §5 的迁移原则：

- **✅ 复用**：Reverser 已有 Apache-2.0 等价实现（或已 clean-room 迁移），不重复建设。
- **⚠️ 补缺**：真实缺口，且落在「Web/JS 逆向」主线内或相邻，值得评估 clean-room 迁移。
- **🚫 排除**：超出主线定位，或触及 `2026-08-11` 版 §4 明确划界的攻击链 / 高权限原生边界。

---

## 4. 34 域决策表

### 4.1 ✅ 复用（14 域）

| jshookmcp 域（工具数）                   | Reverser 对应实现                                                                               | 备注                                                                                                           |
| :--------------------------------------- | :---------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `browser`（76）                          | `BrowserManager` + `page`/`navigation`/`input`/`emulation`/`dom`/`screenshot`/`frames`/`dialog` | Reverser 反检测更强，但工具面未到 jshookmcp 的 76 个细粒度原子；如未来确需增原子面，走「补缺」单列，不整体迁移 |
| `sourcemap`（7）                         | `SourceMapService` + `src/tools/sourcemap`（5 工具）                                            | **已交付**，含 property/集成测试                                                                               |
| `network`（41）                          | `network`/`proxy`/`session` + `frames`（WebSocket）                                             | 覆盖请求捕获 / WebSocket / MITM；缺 HTTP/2 帧构造、GraphQL（见 §4.2）                                          |
| `debugger`（21）                         | `debugger` 域（29 工具）+ `DebuggerManager`                                                     | 断点/单步/脚本源/对象检查/hook 均覆盖                                                                          |
| `core`/`analysis`（25）                  | `analyzer`（8）+ `deobfuscator` + `crypto`（3）                                                 | LLM 去混淆 / 加密识别 / AST 理解均有                                                                           |
| `instrumentation`（13）                  | `hook`（6）+ `crypto`（`hookCryptoJS`/`hookJSEncrypt`/`hookSMCrypto`）                          | JS Hook 是 Reverser 强项                                                                                       |
| `v8-inspector`（22）                     | `src/modules/v8-inspector`                                                                      | 部分覆盖，堆快照/对象图深化可在 relied 场景单独评估                                                            |
| `wasm`（17）                             | `wasm` 域（10 工具）+ `wabt`                                                                    | dump/disassemble/decompile/vmpTrace/offlineRun 全覆盖                                                          |
| `workflow`+`coordination`（12+12）       | `workflow`（9）+ `pipeline` + `advisor`                                                         | observeFlow/autoHook/rebuildBundle 对齐                                                                        |
| `transform`（7）                         | `deobfuscator` + AST 工具链                                                                     | 字符串表 / CF 平坦化 / JSVMP 覆盖                                                                              |
| `proxy`（11）                            | `proxy` 域（6）MITM                                                                             | 缺 GraphQL / HTTP2 之外基本对齐                                                                                |
| `maintenance`（14）                      | `diagnostics`（`diagnoseEnvironment`）                                                          | 部分                                                                                                           |
| `extensions`+`extension-registry`（7+7） | `extensions` + 逆向任务证据链                                                                   | 插件体系语义不同，不整体迁移                                                                                   |
| `platform`（18）                         | `emulation`（4）+ `diagnostics`                                                                 | UA/CPU/网络仿真/环境诊断                                                                                       |

> Reverser 独有能力：`jsvmp`（`hookJsvmpInterpreter`/`analyzeJsvmpVm`/`compareEnv`）在 jshookmcp 侧
> 无对应。这是 Reverser 相对 jshookmcp 的差异化纵深，**不是**差距，不进入迁移队列。

### 4.2 ⚠️ 补缺候选（5 域）

| 域（工具数）                | 缺口                          | 与主线关系                      | 建议优先级 |
| :-------------------------- | :---------------------------- | :------------------------------ | :--------- |
| `graphql`（7）              | network 无 GraphQL 结构化解包 | 高（`network` 直接延伸）        | **P1**     |
| `canvas`（9）+ skia-capture | Skia/Canvas 指令级捕获还原    | 高（纯算/验证码刚需）           | **P1**     |
| `boringssl-inspector`（28） | TLS keylog / 加密流量还原     | 中（对齐协议层反检测）          | **P2**     |
| `protocol-analysis`（20）   | protobuf 等协议逆向           | 中（`trace-processing` 可复用） | **P2**     |
| `webgpu`（9）               | GPU 计算着色器逆向            | 中                              | **P3**     |

排序依据：与「Web/JS 逆向」主线的紧密度 + Reverser 现有资产可复用度。
`graphql`、`canvas` 优先——前者是 `network` 的自然延伸、后者是纯算/验证码的刚需且
`jsvmp`/`stealth` 域已具备相邻设施。

### 4.3 🚫 排除（明确划界，不进入队列）

| jshookmcp 域（工具数）    | 排除理由                                                        |
| :------------------------ | :-------------------------------------------------------------- |
| `exploit-dev`（21）       | 攻击链、ROP 验证（`2026-08-11` §4 已排除）                      |
| `native-emulator`（53）   | 自研 ARM64 模拟器，脱离 Web/JS 定位                             |
| `binary-instrument`（44） | Frida/Ghidra/IDA 桥接，原生高权限                               |
| `memory`（34）            | 进程内存取证（PE 内省/硬件断点）                                |
| `process`（28）           | 跨平台进程管理                                                  |
| `adb-bridge`（26）        | Android 平台                                                    |
| `dart-inspector`（16）    | Flutter/Dart（非 Web/JS 定位）                                  |
| `mojo-ipc`（8）           | Chrome 内部 IPC，平台绑定过强                                   |
| `syscall-hook`（15）      | Linux 系统调用监控                                              |
| `native-bridge`（6）      | 高权限原生桥                                                    |
| `cross-domain`（8）       | 跨服务编排（Reverser 无多服务形态）                             |
| `encoding`（5）           | 已被 `sm-crypto`/`node-forge`/`wabt` 覆盖，无独立价值           |
| `streaming`（17）         | 流媒体还原，脱离主线                                            |
| `trace`（10）             | 语义与 Reverser `trace-processing` 不同，且后者已承载端到端追踪 |

---

## 5. 分波建议

| 波次         | 内容                                                            | 前置         | 预计交付          |
| :----------- | :-------------------------------------------------------------- | :----------- | :---------------- |
| W1（已交付） | SourceMap 完整链路                                              | —            | ✅ 落地           |
| W2           | `graphql` 结构化解包（并入 `network` 域）                       | network 现状 | 2–3 工具 + 1 模块 |
| W3           | `canvas`/skia 捕获还原（私有 `canvas` 域或并入 `stealth` 相邻） | W2 或独立    | 2 工具 + 1 模块   |
| W4           | `boringssl-inspector` / `protocol-analysis` 单项 POC            | W1–W3 后     | 视 POC 再定       |
| 悬挂         | `webgpu` 仅在有真实目标时启动                                   | —            | 不主动            |

每波实施前仍需单独走 `brainstorming → writing-plans → 设计审批`（`2026-08-11` §3.2 已定），
本文只提供「该不该做 + 做哪个」，不替代单波次的 detail 设计。

---

## 6. 附带结论：渐进式发现元层不迁移

jshookmcp 的三档 profile + 8 元工具 + 混合搜索（BM25+向量+亲和图+反馈学习）是为 **668 工具 / 40K token**
的上限设计的。Reverser 仅 **157 工具**，且已有：

- 二档 profile（`workflow`/`full`，`ToolRegistry`）
- 单进程 `ToolSearchEngine`（token 加权 + 子串兜底）

判断：三档 + 向量搜索对 157 工具是**过度设计**，不迁移。唯一值得借鉴的是
「把查工具提升为 MCP 元工具」，但也要等出现「某客户端不支持 `tools/list_changed`」的实证需求再评估。
该结论记录于此，避免未来重复论证。

---

## 7. 风险与未决

1. 本文的「工具数」为抓取时点实测（jshookmcp `0.3.5` 侧 668，Reverser 侧 157），随双方演进会漂移；
   域级结论不受个别工具数浮动影响。
2. `4.1` 中「复用」判定的充分性基于目录清单 + 工具名语义，个别深实现（如 `v8-inspector` 的堆对象图）
   未逐函数核对，W 波次落地前仍须以「差距分析 + brainstorming」回填。
3. `canvas` 域的 skia-capture 与 Reverser 现有 `stealth`（指纹）的职责边界需在 W3 设计时明确，
   避免与「零 JS 注入哲学」冲突（canvas 捕获本身可能引入可被检测的读点）。
