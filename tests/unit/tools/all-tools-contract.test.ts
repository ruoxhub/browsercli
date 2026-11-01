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

  it('full profile exposes exactly 93 tools', () => {
    assert.equal(
      fullEntries.length,
      93,
      `expected exactly 93 tools in full profile, got ${fullEntries.length}`,
    );
  });

  it('pruned domains (extensions, performance, devtools) are absent, and dom contains reveal_in_devtools', async () => {
    const domainNames = new Set(GENERATED_DOMAIN_MANIFESTS.map(m => m.name));
    assert.ok(
      !domainNames.has('extensions'),
      'extensions domain must not exist',
    );
    assert.ok(
      !domainNames.has('performance'),
      'performance domain must not exist',
    );
    assert.ok(!domainNames.has('devtools'), 'devtools domain must not exist');
    assert.ok(domainNames.has('dom'), 'dom domain must exist');

    const domEntries = fullEntries.filter(e => e.domain === 'dom');
    const domToolNames = new Set<string>();
    for (const entry of domEntries) {
      const meta = await loadToolMeta(entry);
      if (meta) domToolNames.add(meta.name);
    }
    assert.ok(
      domToolNames.has('reveal_in_devtools'),
      'dom domain must contain reveal_in_devtools',
    );
  });

  it('does not expose any of the 16 pruned tools in workflow or full profile', async () => {
    const PRUNED_TOOLS = [
      'get_devtools_comments',
      'resolve_devtools_comment',
      'open_devtools',
      'xhr_to_js_breakpoint',
      'set_files',
      'type_text',
      'capture_video_frame',
      'get_video_info',
      'seek_video',
      'start_performance_trace',
      'stop_performance_trace',
      'get_performance_metrics',
      'performance_analyze_insight',
      'emulate_cpu',
      'update_extensions',
      'get_ai_debug_status',
    ] as const;

    for (const profile of ['workflow', 'full'] as const) {
      const entries = registry.listTools(profile);
      const names = new Set<string>();
      for (const entry of entries) {
        const meta = await loadToolMeta(entry);
        if (meta) names.add(meta.name);
      }
      for (const pruned of PRUNED_TOOLS) {
        assert.ok(
          !names.has(pruned),
          `${pruned} must not appear in ${profile} profile`,
        );
      }
      assert.ok(names.has('fill'), `fill must appear in ${profile} profile`);
      assert.ok(
        names.has('press_key'),
        `press_key must appear in ${profile} profile`,
      );
      assert.ok(
        names.has('upload_file'),
        `upload_file must appear in ${profile} profile`,
      );
      if (profile === 'full') {
        assert.ok(
          names.has('break_on_xhr'),
          'break_on_xhr must appear in full profile',
        );
      }
    }
  });
});
