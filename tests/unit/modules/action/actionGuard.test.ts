import test from 'node:test';
import assert from 'node:assert/strict';

import {ActionGuard} from '../../../../src/modules/action/ActionGuard.js';

test('ActionGuard identifies volatile elements correctly', () => {
  assert.equal(
    ActionGuard.isVolatileElement({tagName: 'video'}),
    true,
    'video should be volatile',
  );
  assert.equal(
    ActionGuard.isVolatileElement({className: 'countdown-timer-box'}),
    true,
    'timer class should be volatile',
  );
  assert.equal(
    ActionGuard.isVolatileElement({attributes: {'aria-live': 'polite'}}),
    true,
    'aria-live polite should be volatile',
  );
  assert.equal(
    ActionGuard.isVolatileElement({tagName: 'button', id: 'submit-btn'}),
    false,
    'normal button should not be volatile',
  );
});

test('ActionGuard verifyStability checks stability between snapshots', () => {
  const snap1 = {structureHash: 12345, interactiveCount: 10, timestamp: 100};
  const snap2 = {structureHash: 12345, interactiveCount: 10, timestamp: 200};
  assert.equal(ActionGuard.verifyStability(snap1, snap2), true);

  // Minor change within tolerance
  const snapMinor = {structureHash: 54321, interactiveCount: 12, timestamp: 300};
  assert.equal(ActionGuard.verifyStability(snap1, snapMinor), true);

  // Severe change: count drops by > 50%
  const snapSevere = {structureHash: 99999, interactiveCount: 2, timestamp: 400};
  assert.equal(ActionGuard.verifyStability(snap1, snapSevere), false);
});
