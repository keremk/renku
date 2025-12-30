import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

const eslintConfig = [
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'*.config.js',
			'*.config.mjs',
			'*.config.ts'
		],
	},
	...compat.config({
		extends: ['eslint:recommended', 'prettier'],
		parser: '@typescript-eslint/parser',
		parserOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			ecmaFeatures: {
				jsx: true,
			},
		},
		plugins: ['react', 'react-hooks', '@typescript-eslint'],
		settings: {
			'@typescript-eslint/parser': '@typescript-eslint/parser',
		},
		env: {
			node: true,
			es2022: true,
		},
		globals: {
			process: 'readonly',
			Buffer: 'readonly',
			console: 'readonly',
			__dirname: 'readonly',
			__filename: 'readonly',
			TextEncoder: 'readonly',
			TextDecoder: 'readonly',
			setTimeout: 'readonly',
			clearTimeout: 'readonly',
			setInterval: 'readonly',
			clearInterval: 'readonly',
		},
	}),
	{
		files: ['src/**/*.ts', 'src/**/*.tsx'],
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'prefer-const': 'error',
			'no-var': 'error',
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'eqeqeq': ['error', 'always'],
			'curly': ['error', 'all'],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				args: 'none',
				varsIgnorePattern: '^_',
				argsIgnorePattern: '^_',
			}],
			'react/prop-types': 'off',
			'react/jsx-curly-brace-presence': [
				'error',
				{
					props: 'never',
					children: 'never',
				},
			],
			'react/self-closing-comp': [
				'error',
				{
					component: true,
					html: true,
				},
			],
			'react-hooks/exhaustive-deps': 'warn',
		},
	},
	{
		files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'prefer-const': 'error',
			'no-var': 'error',
			'no-console': 'off',
			'eqeqeq': ['error', 'always'],
			'curly': ['error', 'all'],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', {
				args: 'none',
				varsIgnorePattern: '^_',
				argsIgnorePattern: '^_',
			}],
			'react/prop-types': 'off',
			'react-hooks/exhaustive-deps': 'warn',
		},
	},
];

export default eslintConfig;
