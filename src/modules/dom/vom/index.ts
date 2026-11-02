export {
  applyVomInteractionRecovery,
  isVomReferenceNode,
  isVomStructuralRole,
  prepareObservationRender,
  type RenderRow,
  renderVom,
  selectionMarker,
} from './render.js';
export {
  coverage,
  detectBlockingLayer,
  spansViewport,
} from './layers.js';
export { estimateLineTokens, estimateTokens, TOKEN_ESTIMATOR } from './tokens.js';
export type {
  ActiveScopeBlock,
  BlockingLayer,
  CondSurface,
  LayerKind,
  Rect,
  RenderedRef,
  Viewport,
  VisualEntry,
  VomNode,
  VomOptions,
  VomRef,
  VomResult,
  VomScene,
} from './types.js';
