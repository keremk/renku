import { describe, it, expect } from 'vitest';
import type { SchemaFile } from '@gorenku/providers';
import { extractInputSchemaDefaults } from './schema-defaults.js';

describe('extractInputSchemaDefaults', () => {
	it('extracts nested defaults from object properties', () => {
		const schemaFile: SchemaFile = {
			inputSchema: {
				type: 'object',
				properties: {
					width: { type: 'integer', default: 1920 },
					subtitles: {
						type: 'object',
						properties: {
							font: { type: 'string', default: 'Arial' },
							fontSize: { type: 'integer', default: 48 },
						},
					},
				},
			},
			outputSchema: undefined,
			definitions: {},
			nestedModels: [],
		};

		expect(extractInputSchemaDefaults(schemaFile)).toEqual({
			width: 1920,
			subtitles: {
				font: 'Arial',
				fontSize: 48,
			},
		});
	});

	it('resolves refs when extracting defaults', () => {
		const schemaFile: SchemaFile = {
			inputSchema: {
				type: 'object',
				properties: {
					subtitles: {
						$ref: '#/SubtitleConfig',
					},
				},
			},
			outputSchema: undefined,
			definitions: {
				SubtitleConfig: {
					type: 'object',
					default: {
						font: 'Arial',
						highlightEffect: true,
					},
				},
			},
			nestedModels: [],
		};

		expect(extractInputSchemaDefaults(schemaFile)).toEqual({
			subtitles: {
				font: 'Arial',
				highlightEffect: true,
			},
		});
	});

	it('returns empty object when schema has no defaults', () => {
		const schemaFile: SchemaFile = {
			inputSchema: {
				type: 'object',
				properties: {
					prompt: { type: 'string' },
				},
			},
			outputSchema: undefined,
			definitions: {},
			nestedModels: [],
		};

		expect(extractInputSchemaDefaults(schemaFile)).toEqual({});
	});
});
