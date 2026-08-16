/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export {HeapSnapshotParser} from './HeapSnapshotParser.js';
export {BytecodeExtractor} from './BytecodeExtractor.js';
export {JITInspector} from './JITInspector.js';
export {V8InspectorClient} from './V8InspectorClient.js';
export {VersionDetector} from './VersionDetector.js';
export {DominatorTreeBuilder} from './DominatorTreeBuilder.js';
export {
  collectTurboFanIRIsolated,
  collectTurboFanIRFromDir,
} from './TurboFanTraceCollector.js';
export {parseTurboFanJSON} from './TurboFanGraphParser.js';
export {
  printNativeIgnitionBytecode,
  type NativeSourceContext,
  type IsolatedNativeBytecodeAttempt,
} from './NativeBytecodePrinter.js';
export {
  inspectWasmGc,
  discoverWasmScripts,
  type WasmScript,
  type WasmGcModule,
  type WasmStructInfo,
  type WasmGcInspectionResult,
} from './WasmGcInspector.js';
export type {JITInfo} from './JITInspector.js';
export type {V8Version} from './VersionDetector.js';
export type {DominatorNode, LeakCandidate} from './DominatorTreeBuilder.js';
export type {
  TurboFanIRGraph,
  TurboFanNode,
  TurboFanEdge,
  TurboFanGraphPhase,
  ParsedTurboFanResult,
} from './TurboFanGraphParser.js';
