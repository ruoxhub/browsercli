/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  PageSnapshotManager,
  globalPageSnapshotManager,
} from '../../../../src/modules/snapshot/PageSnapshotManager.js';
import type {AXNode} from '../../../../src/modules/snapshot/types.js';

function createMockPage(axTree: AXNode | null) {
  const locatorsCalled: Array<{type: string; args: unknown[]}> = [];
  return {
    accessibility: {
      snapshot: async (_options?: {interestingOnly?: boolean}) => {
        return axTree;
      },
    },
    getByRole: (role: string, options?: {name?: string | RegExp}) => {
      locatorsCalled.push({type: 'getByRole', args: [role, options]});
      return {
        role,
        options,
        click: async () => undefined,
        fill: async () => undefined,
      };
    },
    getByText: (text: string | RegExp) => {
      locatorsCalled.push({type: 'getByText', args: [text]});
      return {
        text,
        click: async () => undefined,
        fill: async () => undefined,
      };
    },
    locator: (selector: string) => {
      locatorsCalled.push({type: 'locator', args: [selector]});
      return {
        selector,
        click: async () => undefined,
        fill: async () => undefined,
      };
    },
    locatorsCalled,
  };
}

describe('PageSnapshotManager', () => {
  it('captures accessibility tree and formats with UIDs and roles', async () => {
    const mockTree: AXNode = {
      role: 'RootWebArea',
      name: 'Test Page',
      children: [
        {
          role: 'heading',
          name: 'Welcome',
          level: 1,
        },
        {
          role: 'textbox',
          name: 'Username',
          value: 'admin',
          focused: true,
        },
        {
          role: 'button',
          name: 'Submit',
          disabled: false,
        },
      ],
    };

    const manager = new PageSnapshotManager();
    const page = createMockPage(mockTree);

    const result = await manager.capture(page as any);

    assert.ok(result.snapshotId.length > 0);
    assert.strictEqual(result.nodeCount, 4);
    assert.ok(result.formattedText.includes('uid='));
    assert.ok(result.formattedText.includes('RootWebArea "Test Page"'));
    assert.ok(result.formattedText.includes('button "Submit"'));
    assert.ok(result.formattedText.includes('textbox "Username"'));

    // Check UIDs are mapped
    const buttonUid = Array.from(result.idToNode.entries()).find(
      ([_, node]) => node.role === 'button',
    )?.[0];
    assert.ok(buttonUid);

    // Resolve locator by UID
    const locator = manager.getLocatorByUid(page as any, buttonUid);
    assert.ok(locator);
  });

  it('throws helpful self-healing error when snapshot not taken or UID does not exist', async () => {
    const manager = new PageSnapshotManager();
    const page = createMockPage({role: 'button', name: 'OK'});

    // Case 1: no snapshot captured yet
    assert.throws(
      () => {
        manager.getLocatorByUid(page as any, 'invalid_uid');
      },
      {
        message: /No snapshot found for the page/,
      },
    );

    // Case 2: snapshot captured, but UID not in it
    await manager.capture(page as any);
    assert.throws(
      () => {
        manager.getLocatorByUid(page as any, 'invalid_uid');
      },
      {
        message: /Element uid "invalid_uid" not found/,
      },
    );
  });

  it('clears snapshots on demand or page reset', async () => {
    const manager = new PageSnapshotManager();
    const page = createMockPage({role: 'button', name: 'OK'});

    const result = await manager.capture(page as any);
    const uid = Array.from(result.idToNode.keys())[0];
    assert.ok(manager.getLocatorByUid(page as any, uid));

    manager.clear(page as any);

    assert.throws(() => {
      manager.getLocatorByUid(page as any, uid);
    });
  });

  it('falls back to CDP Accessibility.getFullAXTree when page.accessibility is undefined (patchright v1.59+)', async () => {
    const locatorsCalled: Array<{type: string; args: unknown[]}> = [];
    let detached = false;
    const mockCdpSession = {
      send: async (method: string) => {
        if (method === 'Accessibility.getFullAXTree') {
          return {
            nodes: [
              {
                nodeId: '1',
                ignored: false,
                role: {type: 'role', value: 'RootWebArea'},
                name: {type: 'computedString', value: 'CDP Page'},
                childIds: ['2'],
              },
              {
                nodeId: '2',
                parentId: '1',
                ignored: true,
                role: {type: 'internalRole', value: 'none'},
                childIds: ['3', '4', '5'],
              },
              {
                nodeId: '3',
                parentId: '2',
                ignored: false,
                role: {type: 'role', value: 'heading'},
                name: {type: 'computedString', value: 'Welcome'},
                properties: [{name: 'level', value: {type: 'integer', value: 1}}],
                childIds: ['6'],
              },
              {
                nodeId: '6',
                parentId: '3',
                ignored: false,
                role: {type: 'role', value: 'StaticText'},
                name: {type: 'computedString', value: 'Welcome'},
                childIds: [],
              },
              {
                nodeId: '4',
                parentId: '2',
                ignored: false,
                role: {type: 'role', value: 'button'},
                name: {type: 'computedString', value: 'Submit'},
                childIds: ['7'],
              },
              {
                nodeId: '7',
                parentId: '4',
                ignored: false,
                role: {type: 'role', value: 'StaticText'},
                name: {type: 'computedString', value: 'Submit'},
                childIds: [],
              },
              {
                nodeId: '5',
                parentId: '2',
                ignored: false,
                role: {type: 'role', value: 'textbox'},
                name: {type: 'computedString', value: 'Email'},
                value: {type: 'string', value: 'alice@example.com'},
                properties: [
                  {name: 'focused', value: {type: 'boolean', value: true}},
                ],
                childIds: [],
              },
            ],
          };
        }
        return {};
      },
      detach: async () => {
        detached = true;
      },
    };

    const pageWithoutAccessibility = {
      context: () => ({
        newCDPSession: async () => mockCdpSession,
      }),
      getByRole: (role: string, options?: {name?: string | RegExp}) => {
        locatorsCalled.push({type: 'getByRole', args: [role, options]});
        return {role, options};
      },
      getByText: (text: string) => ({text}),
      locator: (selector: string) => ({selector}),
    };

    const manager = new PageSnapshotManager();
    const result = await manager.capture(pageWithoutAccessibility as any);

    assert.equal(detached, true);
    assert.equal(result.root.name, 'CDP Page');
    assert.equal(result.nodeCount, 4);
    assert.ok(result.formattedText.includes('heading "Welcome" (level=1)'));
    assert.ok(result.formattedText.includes('button "Submit"'));
    assert.ok(
      result.formattedText.includes(
        'textbox "Email" value="alice@example.com" (focused)',
      ),
    );
    assert.equal(result.formattedText.includes('Empty Document'), false);

    const buttonUid = Array.from(result.idToNode.entries()).find(
      ([_, node]) => node.role === 'button',
    )?.[0];
    assert.ok(buttonUid);
    manager.getLocatorByUid(pageWithoutAccessibility as any, buttonUid);
    assert.equal(locatorsCalled[0]?.type, 'getByRole');
    assert.equal(locatorsCalled[0]?.args[0], 'button');
  });

  it('provides a singleton globalPageSnapshotManager', () => {
    assert.ok(globalPageSnapshotManager instanceof PageSnapshotManager);
  });
});
