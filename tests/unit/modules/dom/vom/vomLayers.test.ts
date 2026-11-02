import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectBlockingLayer,
  renderVom,
  type VomNode,
  type VomScene,
} from '../../../../../src/modules/dom/vom/index.js';

test('detectBlockingLayer identifies modal blocking background', () => {
  const vp = { width: 1000, height: 800 };
  const nodes: VomNode[] = [
    {
      id: 1,
      parentId: null,
      tag: 'div',
      role: 'main',
      name: 'Background Page',
      paintOrder: 1,
      position: 'static',
      pointerEvents: 'auto',
      rect: { x: 0, y: 0, w: 1000, h: 800 },
      clickable: false,
    },
    {
      id: 2,
      parentId: 1,
      tag: 'button',
      role: 'button',
      name: 'Background Button',
      paintOrder: 2,
      position: 'static',
      pointerEvents: 'auto',
      rect: { x: 50, y: 50, w: 100, h: 40 },
      clickable: true,
      referenceable: true,
    },
    {
      id: 3,
      parentId: null,
      tag: 'div',
      role: 'dialog',
      modal: true,
      name: 'Modal Dialog',
      paintOrder: 10,
      position: 'fixed',
      pointerEvents: 'auto',
      rect: { x: 0, y: 0, w: 1000, h: 800 },
      clickable: false,
    },
    {
      id: 4,
      parentId: 3,
      tag: 'button',
      role: 'button',
      name: 'Modal Submit',
      paintOrder: 11,
      position: 'static',
      pointerEvents: 'auto',
      rect: { x: 200, y: 200, w: 120, h: 40 },
      clickable: true,
      referenceable: true,
    },
  ];

  const layer = detectBlockingLayer(nodes, vp);
  assert.ok(layer, 'Blocking layer should be detected');
  assert.equal(layer.kind, 'modal');
  assert.equal(layer.rootId, 3);
  assert.ok(layer.members.has(3));
  assert.ok(layer.members.has(4));
  assert.equal(layer.members.has(1), false);
  assert.equal(layer.members.has(2), false);

  const scene: VomScene = {
    viewport: vp,
    nodes,
  };

  const result = renderVom(scene);
  assert.ok(result.text.includes('Modal Submit'));
  assert.equal(result.text.includes('Background Button'), false);
});
