import { mock } from 'node:test';
import * as runtimeModule from '../build/src/runtime.js';
console.log('Original getRuntime:', runtimeModule.getRuntime);
try {
  mock.method(runtimeModule, 'getRuntime', () => {
    return { mock: true };
  });
  console.log('Mocked getRuntime:', runtimeModule.getRuntime());
} catch (e) {
  console.error('Failed to mock:', e);
}
