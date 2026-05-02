import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import tailwind from 'eslint-plugin-tailwindcss'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'server-dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      ...tailwind.configs['flat/recommended'],
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    settings: {
      tailwindcss: {
        // Provide an empty config object to suppress "Cannot resolve default tailwindcss config path" warnings
        // This tells the plugin not to try auto-detecting the config path
        config: {},
        // Whitelist all custom Shadcn UI theme classes using CSS variables
        whitelist: [
          // Match any class using these color tokens (e.g., bg-primary, text-muted-foreground, etc.)
          '(bg|text|border|ring|fill|stroke|outline|shadow|divide|from|via|to|placeholder|decoration|caret|accent)-(background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring|chart-[1-5]|sidebar|sidebar-foreground|sidebar-primary|sidebar-primary-foreground|sidebar-accent|sidebar-accent-foreground|sidebar-border|sidebar-active-bg|sidebar-ring|surface-elevated|surface-border)(\\/\\d+)?',
        ],
      },
    },
    rules: {
      // Allow unused variables with underscore prefix (for intentionally unused parameters)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Tailwind CSS rules
      // The no-custom-classname rule produces false positives with Shadcn UI's custom theme classes
      // even with whitelist, so disable it until better Tailwind v4 support is available
      'tailwindcss/no-custom-classname': 'off',
      // These rules provide value without requiring full config resolution
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',
      'tailwindcss/enforces-shorthand': 'warn',
      'tailwindcss/no-arbitrary-value': 'off', // Keep off - arbitrary values are valid
      // Disable rules that require full Tailwind v4 config resolution (not yet working)
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
    },
  },
])
