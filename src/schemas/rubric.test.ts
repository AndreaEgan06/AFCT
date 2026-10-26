import { describe, expect, it } from 'vitest';
import { BINARY_RUBRIC_DEFINITION, RubricDefinitionSchema } from './rubric';

// RUBRIC: binary-only until the shape is decided.
describe('RubricDefinitionSchema', () => {
  it('accepts the binary definition', () => {
    expect(RubricDefinitionSchema.parse(BINARY_RUBRIC_DEFINITION)).toEqual({
      version: 1,
      kind: 'binary',
    });
  });

  it.each([
    [{ version: 2, kind: 'binary' }],
    [{ version: 1, kind: 'perState' }],
    [{ version: 1, kind: 'binary', weights: [] }],
  ])('rejects anything else: %j', (definition) => {
    expect(RubricDefinitionSchema.safeParse(definition).success).toBe(false);
  });
});
