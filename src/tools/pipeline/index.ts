/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export {definePipeline, parallel, when} from './definePipeline.js';
export {analyzePipeline} from './examples.js';
export type {
  PipelineContext,
  PipelineDef,
  PipelineStep,
  StepFn,
  StepResult,
} from './types.js';
