import type { SchemaFile } from '@gorenku/providers';

interface JsonSchema {
	type?: string | string[];
	default?: unknown;
	properties?: Record<string, JsonSchema | boolean>;
	items?: JsonSchema | boolean;
	anyOf?: Array<JsonSchema | boolean>;
	oneOf?: Array<JsonSchema | boolean>;
	$ref?: string;
}

function cloneDefaultValue<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function resolveRefName(ref: string): string | undefined {
	const directMatch = ref.match(/^#\/([A-Za-z_][A-Za-z0-9_]*)$/);
	if (directMatch) {
		return directMatch[1];
	}
	const defsMatch = ref.match(/^#\/\$defs\/([A-Za-z_][A-Za-z0-9_]*)$/);
	if (defsMatch) {
		return defsMatch[1];
	}
	return undefined;
}

function resolveSchemaDefaults(
	schema: JsonSchema,
	definitions: Record<string, JsonSchema>,
	seenRefs: Set<string> = new Set()
): unknown {
	if (schema.$ref) {
		const refName = resolveRefName(schema.$ref);
		if (!refName || seenRefs.has(refName)) {
			return undefined;
		}
		const resolvedSchema = definitions[refName];
		if (!resolvedSchema) {
			return undefined;
		}
		const nextSeenRefs = new Set(seenRefs);
		nextSeenRefs.add(refName);
		return resolveSchemaDefaults(resolvedSchema, definitions, nextSeenRefs);
	}

	if (schema.default !== undefined) {
		return cloneDefaultValue(schema.default);
	}

	const variants = schema.anyOf ?? schema.oneOf;
	if (variants && variants.length > 0) {
		const firstVariant = variants[0];
		if (
			firstVariant &&
			typeof firstVariant === 'object' &&
			!Array.isArray(firstVariant)
		) {
			return resolveSchemaDefaults(firstVariant, definitions, seenRefs);
		}
	}

	const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
	if (schemaType === 'object' || schema.properties) {
		const defaults: Record<string, unknown> = {};
		for (const [key, propertySchema] of Object.entries(
			schema.properties ?? {}
		)) {
			if (
				!propertySchema ||
				typeof propertySchema !== 'object' ||
				Array.isArray(propertySchema)
			) {
				continue;
			}
			const propertyDefault = resolveSchemaDefaults(
				propertySchema,
				definitions,
				seenRefs
			);
			if (propertyDefault !== undefined) {
				defaults[key] = propertyDefault;
			}
		}
		if (Object.keys(defaults).length > 0) {
			return defaults;
		}
	}

	return undefined;
}

export function extractInputSchemaDefaults(
	schemaFile: SchemaFile
): Record<string, unknown> {
	const defaults = resolveSchemaDefaults(
		schemaFile.inputSchema as JsonSchema,
		schemaFile.definitions as Record<string, JsonSchema>
	);

	if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
		return defaults as Record<string, unknown>;
	}

	return {};
}
