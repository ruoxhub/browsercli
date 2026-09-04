/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type {AIConfig} from '../../../src/config/schema.js';
import {AIService} from '../../../src/services/AIService.js';
import {createAIService} from '../../../src/services/createAIService.js';

test('createAIService creates AIService instance when given valid openai config', () => {
  const config: AIConfig = {
    provider: 'openai',
    openai: {
      apiKey: 'test-api-key',
      baseURL: 'https://api.example.com/v1',
      model: 'gpt-4o',
    },
  };

  const service = createAIService(config);
  assert(service instanceof AIService);
  assert.equal(service.isAvailable(), true);
});

test('createAIService returns undefined when config is null', () => {
  const service = createAIService(null as unknown as AIConfig);
  assert.equal(service, undefined);
});

test('createAIService throws error for unsupported provider', () => {
  const config = {
    provider: 'unsupported-provider' as unknown,
  } as AIConfig;

  assert.throws(() => createAIService(config), {
    message: /Unknown provider: unsupported-provider/,
  });
});
