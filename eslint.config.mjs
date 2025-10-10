import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import tsRules from './lint/ts-rules.mjs';
import esRules from './lint/es-rules.mjs';

export default tseslint.config(
  {
    ignores: ['node_modules/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      '**/*.mjs',
      '**/*.js',
      '**/*.jsx',
    ],
    rules: {
      ...esRules,
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
    ],
    rules: {
      ...esRules,
      ...tsRules,
    },
  },
);
