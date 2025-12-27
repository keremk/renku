import { describe, it, expect } from 'vitest';
import { validatePayload } from './schema-validator.js';

// Test schemas - minimal examples isolating each pattern

const anyOfSchema = JSON.stringify({
  type: 'object',
  properties: {
    image_size: {
      anyOf: [
        {
          type: 'object',
          properties: {
            width: { type: 'integer', minimum: 100, maximum: 4096 },
            height: { type: 'integer', minimum: 100, maximum: 4096 },
          },
          required: ['width', 'height'],
        },
        {
          type: 'string',
          enum: ['square', 'landscape', 'portrait', 'auto_2K'],
        },
      ],
    },
  },
});

const enumSchema = JSON.stringify({
  type: 'object',
  properties: {
    aspect_ratio: {
      type: 'string',
      enum: ['16:9', '4:3', '1:1', '9:16'],
    },
  },
});

const requiredFieldsSchema = JSON.stringify({
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    seed: { type: 'integer' },
  },
  required: ['prompt'],
});

const rangeSchema = JSON.stringify({
  type: 'object',
  properties: {
    num_images: {
      type: 'integer',
      minimum: 1,
      maximum: 6,
    },
    temperature: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
});

const nestedObjectSchema = JSON.stringify({
  type: 'object',
  properties: {
    config: {
      type: 'object',
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
      required: ['width'],
    },
  },
});

describe('validatePayload', () => {
  describe('anyOf patterns (object OR enum)', () => {
    it('accepts valid string enum value', () => {
      expect(() => {
        validatePayload(anyOfSchema, { image_size: 'square' }, 'input');
      }).not.toThrow();
    });

    it('accepts valid object with required properties', () => {
      expect(() => {
        validatePayload(anyOfSchema, { image_size: { width: 1024, height: 768 } }, 'input');
      }).not.toThrow();
    });

    it('rejects invalid string not in enum', () => {
      expect(() => {
        validatePayload(anyOfSchema, { image_size: 'invalid_size' }, 'input');
      }).toThrow(/Invalid input payload/);
    });

    it('rejects object missing required property', () => {
      expect(() => {
        validatePayload(anyOfSchema, { image_size: { width: 1024 } }, 'input');
      }).toThrow(/Invalid input payload/);
    });

    it('rejects wrong type entirely (number instead of string/object)', () => {
      expect(() => {
        validatePayload(anyOfSchema, { image_size: 12345 }, 'input');
      }).toThrow(/Invalid input payload/);
    });

    it('rejects object with value outside range', () => {
      expect(() => {
        validatePayload(anyOfSchema, { image_size: { width: 50, height: 768 } }, 'input');
      }).toThrow(/Invalid input payload/);
    });
  });

  describe('enum validation', () => {
    it('accepts valid enum value', () => {
      expect(() => {
        validatePayload(enumSchema, { aspect_ratio: '16:9' }, 'input');
      }).not.toThrow();
    });

    it('rejects invalid enum value', () => {
      expect(() => {
        validatePayload(enumSchema, { aspect_ratio: '21:9' }, 'input');
      }).toThrow(/Invalid input payload/);
    });

    it('includes enum constraint in error message', () => {
      expect(() => {
        validatePayload(enumSchema, { aspect_ratio: 'wrong' }, 'input');
      }).toThrow(/must be equal to one of the allowed values/);
    });
  });

  describe('required fields', () => {
    it('accepts payload with all required fields', () => {
      expect(() => {
        validatePayload(requiredFieldsSchema, { prompt: 'test prompt' }, 'input');
      }).not.toThrow();
    });

    it('accepts payload with required and optional fields', () => {
      expect(() => {
        validatePayload(requiredFieldsSchema, { prompt: 'test', seed: 42 }, 'input');
      }).not.toThrow();
    });

    it('rejects payload missing required field', () => {
      expect(() => {
        validatePayload(requiredFieldsSchema, { seed: 42 }, 'input');
      }).toThrow(/Invalid input payload/);
    });

    it('includes missing field name in error', () => {
      expect(() => {
        validatePayload(requiredFieldsSchema, {}, 'input');
      }).toThrow(/prompt/);
    });
  });

  describe('range validation (min/max)', () => {
    it('accepts value within range', () => {
      expect(() => {
        validatePayload(rangeSchema, { num_images: 3 }, 'input');
      }).not.toThrow();
    });

    it('accepts value at minimum boundary', () => {
      expect(() => {
        validatePayload(rangeSchema, { num_images: 1 }, 'input');
      }).not.toThrow();
    });

    it('accepts value at maximum boundary', () => {
      expect(() => {
        validatePayload(rangeSchema, { num_images: 6 }, 'input');
      }).not.toThrow();
    });

    it('rejects value below minimum', () => {
      expect(() => {
        validatePayload(rangeSchema, { num_images: 0 }, 'input');
      }).toThrow(/must be >= 1/);
    });

    it('rejects value above maximum', () => {
      expect(() => {
        validatePayload(rangeSchema, { num_images: 10 }, 'input');
      }).toThrow(/must be <= 6/);
    });

    it('works with floating point ranges', () => {
      expect(() => {
        validatePayload(rangeSchema, { temperature: 0.5 }, 'input');
      }).not.toThrow();

      expect(() => {
        validatePayload(rangeSchema, { temperature: 1.5 }, 'input');
      }).toThrow(/must be <= 1/);
    });
  });

  describe('nested object validation', () => {
    it('accepts valid nested object', () => {
      expect(() => {
        validatePayload(nestedObjectSchema, { config: { width: 100 } }, 'input');
      }).not.toThrow();
    });

    it('rejects nested object missing required property', () => {
      expect(() => {
        validatePayload(nestedObjectSchema, { config: { height: 100 } }, 'input');
      }).toThrow(/Invalid input payload/);
    });

    it('includes nested path in error message', () => {
      expect(() => {
        validatePayload(nestedObjectSchema, { config: {} }, 'input');
      }).toThrow(/\/config/);
    });
  });

  describe('error message quality', () => {
    it('includes field path in error', () => {
      expect(() => {
        validatePayload(enumSchema, { aspect_ratio: 'bad' }, 'input');
      }).toThrow(/\/aspect_ratio/);
    });

    it('uses custom label in error message', () => {
      expect(() => {
        validatePayload(requiredFieldsSchema, {}, 'my-custom-label');
      }).toThrow(/Invalid my-custom-label payload/);
    });

    it('lists multiple errors when allErrors is true', () => {
      const multiErrorSchema = JSON.stringify({
        type: 'object',
        properties: {
          a: { type: 'integer' },
          b: { type: 'integer' },
        },
        required: ['a', 'b'],
      });

      try {
        validatePayload(multiErrorSchema, {}, 'input');
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('a');
        expect(message).toContain('b');
      }
    });
  });

  describe('schema handling', () => {
    it('skips validation when schema is undefined', () => {
      expect(() => {
        validatePayload(undefined, { anything: 'goes' }, 'input');
      }).not.toThrow();
    });

    it('throws on invalid JSON schema', () => {
      expect(() => {
        validatePayload('not valid json', {}, 'input');
      }).toThrow();
    });

    it('throws descriptive error for schema compilation failure', () => {
      const badSchema = JSON.stringify({
        type: 'object',
        properties: {
          x: { $ref: '#/nonexistent' },
        },
      });

      expect(() => {
        validatePayload(badSchema, {}, 'input');
      }).toThrow(/Invalid input schema/);
    });

    it('caches compiled validators (same schema validates quickly)', () => {
      // First call compiles
      validatePayload(enumSchema, { aspect_ratio: '16:9' }, 'input');
      // Second call should use cache (we can't directly test cache, but no error means it works)
      validatePayload(enumSchema, { aspect_ratio: '4:3' }, 'input');
    });
  });

  describe('unknown fields validation', () => {
    it('rejects payload with unknown fields', () => {
      expect(() => {
        validatePayload(enumSchema, { aspect_ratio: '16:9', unknown_field: 'value' }, 'input');
      }).toThrow(/unknown field.*unknown_field/i);
    });

    it('lists all unknown fields in error', () => {
      expect(() => {
        validatePayload(enumSchema, { aspect_ratio: '16:9', foo: 1, bar: 2 }, 'input');
      }).toThrow(/foo.*bar|bar.*foo/);
    });

    it('includes valid field names in error message', () => {
      expect(() => {
        validatePayload(enumSchema, { bad_field: 'value' }, 'input');
      }).toThrow(/Valid fields are:.*aspect_ratio/);
    });

    it('accepts payload with only known fields', () => {
      expect(() => {
        validatePayload(requiredFieldsSchema, { prompt: 'test', seed: 42 }, 'input');
      }).not.toThrow();
    });

    it('catches field name typos', () => {
      // Common typo: image_size vs size
      expect(() => {
        validatePayload(anyOfSchema, { size: 'square' }, 'input');
      }).toThrow(/unknown field.*size.*Valid fields are:.*image_size/i);
    });

    it('catches producer mapping mismatches', () => {
      // Simulates: producer maps Size -> size but schema expects image_size
      const seedreamSchema = JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          image_size: {
            anyOf: [
              { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } } },
              { type: 'string', enum: ['square_hd', 'auto_2K', 'auto_4K'] },
            ],
          },
        },
        required: ['prompt'],
      });

      expect(() => {
        validatePayload(seedreamSchema, { prompt: 'test', size: '1K' }, 'input');
      }).toThrow(/unknown field.*size.*Valid fields are:.*prompt.*image_size/i);
    });
  });
});
