/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as resolver from '../../../src/config/resolver.js';
import * as servicesConfig from '../../../src/config/servicesConfig.js';

test('resolver does not re-export servicesConfig symbols', () => {
  const resolverAny = resolver as Record<string, unknown>;
  assert.equal(resolverAny.createAIService, undefined);
  assert.equal(resolverAny.getBrowserManagerConfig, undefined);
  assert.equal(resolverAny.getAIConfig, undefined);
  assert.equal(resolverAny.getBrowserConfig, undefined);
  assert.equal(resolverAny.getDefaultLLMProvider, undefined);
  assert.equal(resolverAny.getSystemConfig, undefined);
  assert.equal(resolverAny.isDebugEnabled, undefined);
  assert.equal(resolverAny.validateConfig, undefined);
});

test('servicesConfig exports browser and system config functions directly', () => {
  assert.equal(typeof servicesConfig.getBrowserManagerConfig, 'function');
  assert.equal(typeof servicesConfig.getAIConfig, 'function');
  assert.equal(typeof servicesConfig.getDefaultLLMProvider, 'function');
  assert.equal(typeof servicesConfig.getBrowserConfig, 'function');
  assert.equal(typeof servicesConfig.getSystemConfig, 'function');
  assert.equal(typeof servicesConfig.isDebugEnabled, 'function');
  assert.equal(typeof servicesConfig.validateConfig, 'function');
});
