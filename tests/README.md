# Tests

This directory contains tests for the js-reverse-mcp project.

## Directory Structure

```
tests/
├── setup.ts / setup.js      # Test setup
├── unit/                    # Unit tests, mirrored from src/
│   ├── browser/
│   ├── modules/
│   ├── tools/
│   ├── worker/
│   ├── services/
│   └── ...
├── integration/             # Integration tests (*.integration.test.ts)
├── property/                # Property tests (fast-check)
├── performance/             # Perf tests (opt-in via RUN_PERF_TESTS)
├── manual/                  # Standalone scripts
└── README.md
```

## Running Tests

### Unit Tests

Run all unit tests:

```bash
npm test
```

Run tests without rebuilding:

```bash
npm run test:only:no-build
```

Run only specific tests (marked with `.only`):

```bash
npm run test:only
```

### Focused Refactor Suites

- `npm run test:worker` verifies the worker adapter, execution pipeline, context provider, and lifecycle units.
- `npm run test:registry` verifies generated tool metadata and profile-aware registry behavior.
- Run `npm run typecheck`, `npm run check-format`, and `npm run test:unit` before merging execution-pipeline or registry changes.

### Integration Tests

Integration tests verify the actual behavior of components with real dependencies:

```bash
# Run all tests including integration tests
npm test

# Run only integration tests
npm test -- tests/integration/
```

**Note:** Integration tests for Gemini CLI require `gemini-cli` to be installed:

```bash
npm install -g @google/generative-ai-cli
```

If `gemini-cli` is not available, those tests will be skipped with a warning.

### Manual Tests

Manual tests are standalone scripts that can be run directly:

```bash
# Test GeminiProvider
node --experimental-strip-types tests/manual/test-gemini-provider.ts
```

## Writing Tests

### Unit Tests

Unit tests use Node.js built-in test runner. Example:

```typescript
import {describe, it} from 'node:test';
import assert from 'node:assert';

describe('MyModule', () => {
  it('should do something', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

### Test Organization

- Place unit tests in `tests/unit/` mirroring the source structure
- Place integration tests in `tests/integration/`
- Use `.test.ts` suffix for test files
- Use `.integration.test.ts` suffix for integration test files
- Group related tests using `describe` blocks
- Use descriptive test names with `it` blocks

### Unit vs Integration Tests

**Unit Tests:**

- Test individual components in isolation
- Use mocks and stubs for dependencies
- Fast execution
- No external dependencies required

**Integration Tests:**

- Test components with real dependencies
- Verify actual behavior with external systems
- May require setup (e.g., installing CLI tools)
- Tests may be skipped if dependencies are unavailable

## Test Coverage

The project aims for 80% test coverage. Run coverage against the current tool/service include list:

```bash
npm run coverage
# or the same include set explicitly:
npm run coverage:core
```

`coverage:core` includes `build/src/tools/dom/**`, `hook/**`, `stealth/**`, plus `AIService.js` and `LLMService.js`. For a full-src report use `npm run coverage:strict`.

## CI/CD

Tests are automatically run on every commit in the CI pipeline.
