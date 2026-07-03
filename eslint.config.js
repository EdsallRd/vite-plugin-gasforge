import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        // eslint-disable-next-line no-undef
        tsconfigRootDir: import.meta.dirname || process.cwd(),
      },
    },
    rules: {
      // Enforce the prohibition of deprecated APIs
      '@typescript-eslint/no-deprecated': 'error',

      // Downgrade highly strict type-checked rules to 'warn' to allow progressive adoption in existing codebase
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/array-type': 'warn',
      '@typescript-eslint/triple-slash-reference': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // Good practice TS rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    rules: {
      'eqeqeq': ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-useless-assignment': 'warn',
    },
  }
);
