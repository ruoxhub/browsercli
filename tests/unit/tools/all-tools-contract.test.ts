/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {GENERATED_DOMAIN_MANIFESTS} from '../../../src/tools/generated-tools-index.js';
import {ToolRegistry} from '../../../src/tools/registry/ToolRegistry.js';
import type {ToolRuntimeRequirements} from '../../../src/tools/ToolDefinition.js';
import {
  areRequirementsEqual,
  loadToolMeta,
  type ToolMeta,
} from '../../../src/tools/tools-meta.js';

const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);
const fullEntries = registry.listTools('full');

const VALID_FIELDS: ReadonlyArray<keyof ToolRuntimeRequirements> = [
  'browser',
  'page',
  'frame',
  'debugger',
  'nativeTools',
  'recovery',
];

/** 声明式 requirements 字段值必须落在契约允许的字面量集合内。 */
function assertValidRequirements(
  toolName: string,
  requirements: ToolRuntimeRequirements,
): void {
  for (const key of Object.keys(requirements) as Array<
    keyof ToolRuntimeRequirements
  >) {
    assert.ok(
      VALID_FIELDS.includes(key),
      `tool ${toolName} declares unknown requirement field "${key}"`,
    );
  }
  if (requirements.browser !== undefined) {
    assert.equal(requirements.browser, 'connected', toolName);
  }
  if (requirements.page !== undefined) {
    assert.equal(requirements.page, 'selected', toolName);
  }
  if (requirements.frame !== undefined) {
    assert.equal(requirements.frame, 'selected', toolName);
  }
  if (requirements.debugger !== undefined) {
    assert.ok(
      ['available', 'paused', 'running'].includes(requirements.debugger),
      toolName,
    );
  }
  if (requirements.nativeTools !== undefined) {
    assert.ok(Array.isArray(requirements.nativeTools), toolName);
  }
  if (requirements.recovery !== undefined) {
    assert.equal(typeof requirements.recovery, 'boolean', toolName);
  }
}

describe('all-tools contract (Layer 1)', () => {
  it('enumerates a non-empty full-profile set', () => {
    assert.ok(fullEntries.length > 0, 'full profile should be non-empty');
  });

  it('every registered tool loads to non-null ToolMeta (no requirement conflicts, no missing exports)', async () => {
    const failures: string[] = [];
    const metas: ToolMeta[] = [];
    for (const entry of fullEntries) {
      const meta = await loadToolMeta(entry);
      if (meta === null) {
        failures.push(`${entry.domain}:${entry.handlerName}`);
      } else {
        metas.push(meta);
        assertValidRequirements(meta.name, meta.requirements ?? {});
      }
    }

    assert.deepEqual(
      failures,
      [],
      `tools that failed to load meta (conflict / missing export / not defineTool):\n  ${failures.join(
        '\n  ',
      )}`,
    );

    // Loaded set must equal discovered set — no tool silently dropped.
    assert.equal(
      metas.length,
      fullEntries.length,
      'loaded ToolMeta count must equal registry discovery count',
    );
  });

  it('assigns a unique tool name to every registered entry', async () => {
    const names = new Map<string, string>();
    for (const entry of fullEntries) {
      const meta = await loadToolMeta(entry);
      assert.ok(meta, `${entry.domain}:${entry.handlerName} failed to load`);
      if (names.has(meta.name)) {
        assert.fail(
          `duplicate tool name "${meta.name}" (${names.get(meta.name)} vs ${entry.domain}:${entry.handlerName})`,
        );
      }
      names.set(meta.name, `${entry.domain}:${entry.handlerName}`);
    }
  });

  it('preserves requirements through Registry -> ToolMeta serialization', async () => {
    for (const entry of fullEntries) {
      if (!entry.requirements) continue;
      const meta = await loadToolMeta(entry);
      assert.ok(meta, `${entry.domain}:${entry.handlerName} failed to load`);
      assert.ok(
        areRequirementsEqual(meta.requirements, entry.requirements),
        `requirements mismatch for ${meta.name}: meta=${JSON.stringify(meta.requirements)} entry=${JSON.stringify(entry.requirements)}`,
      );
    }
  });

  it('every ToolMeta carries a modulePath + handlerName resolvable to a defineTool', async () => {
    for (const entry of fullEntries) {
      const meta = await loadToolMeta(entry);
      assert.ok(meta, `${entry.domain}:${entry.handlerName} failed to load`);
      assert.equal(meta.callMode, 'defineTool', meta.name);
      assert.ok(meta.modulePath, meta.name);
      assert.ok(meta.handlerName, meta.name);
      assert.equal(typeof meta.name, 'string');
      assert.ok(meta.name.length > 0);
      assert.equal(typeof meta.description, 'string');
    }
  });

  it('does not expose type_text in workflow or full profile, preserving fill and press_key', async () => {
    for (const profile of ['workflow', 'full'] as const) {
      const entries = registry.listTools(profile);
      const names = new Set<string>();
      for (const entry of entries) {
        const meta = await loadToolMeta(entry);
        if (meta) names.add(meta.name);
      }
      assert.ok(
        !names.has('type_text'),
        `type_text must not appear in ${profile} profile`,
      );
      assert.ok(names.has('fill'), `fill must appear in ${profile} profile`);
      assert.ok(
        names.has('press_key'),
        `press_key must appear in ${profile} profile`,
      );
    }
  });
});
