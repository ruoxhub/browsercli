/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {updateExtensions} from '../../../../src/tools/extensions/updateExtensions.js';

class FakeNode {
  children: FakeNode[] = [];
  shadowRoot: FakeNode | null = null;
  private readonly matches = new Map<string, FakeNode>();

  querySelector(selector: string): FakeNode | null {
    return this.matches.get(selector) ?? null;
  }

  setMatch(selector: string, node: FakeNode): void {
    this.matches.set(selector, node);
  }
}

describe('updateExtensions', () => {
  it('finds and clicks updateNow inside nested shadow roots', async () => {
    const manager = new FakeNode();
    const managerShadowRoot = new FakeNode();
    const toolbar = new FakeNode();
    const toolbarShadowRoot = new FakeNode();
    const updateButton = new FakeNode() as FakeNode & {
      disabled: boolean;
      clicked: boolean;
      click(): void;
    };
    updateButton.disabled = false;
    updateButton.clicked = false;
    updateButton.click = () => {
      updateButton.clicked = true;
    };

    manager.shadowRoot = managerShadowRoot;
    managerShadowRoot.setMatch('extensions-toolbar', toolbar);
    managerShadowRoot.children = [toolbar];
    toolbar.shadowRoot = toolbarShadowRoot;
    toolbarShadowRoot.setMatch('#updateNow', updateButton);

    const fakeDocument = {
      querySelector: (selector: string) =>
        selector === 'extensions-manager' ? manager : null,
    };
    const frame = {
      evaluate: async (code: string) =>
        new Function('document', 'code', 'return eval(code)')(
          fakeDocument,
          code,
        ),
    };
    const response = {
      setStructuredContent: (content: unknown) => {
        response.content = content;
      },
      content: undefined as unknown,
    };

    await updateExtensions.handler(
      {params: {}},
      response as never,
      {getSelectedFrame: () => frame} as never,
    );

    assert.deepEqual(response.content, {
      success: true,
      message: 'Chrome extensions update initiated successfully.',
      tooltype: 'update_extensions',
    });
    assert.equal(updateButton.clicked, true);
  });
});
