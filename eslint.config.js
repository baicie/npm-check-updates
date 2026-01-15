import js from '@eslint/js'
import jsdoc from 'eslint-plugin-jsdoc'
import tseslint from 'typescript-eslint'

export default [
  // 忽略文件
  {
    ignores: ['dist/**', 'test'],
  },

  // JavaScript 文件配置
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'module',
      globals: {
        es6: true,
        mocha: true,
        node: true,
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
      },
    },
    plugins: {
      jsdoc,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': 'off',
      'no-redeclare': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: ['VariableDeclarator > ArrowFunctionExpression'],
          require: {
            ClassDeclaration: true,
            ClassExpression: true,
          },
        },
      ],
    },
  },

  // TypeScript 文件配置
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
      globals: {
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      jsdoc,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      'no-empty': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/array-type': [
        'error',
        {
          default: 'array',
        },
      ],
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: ['VariableDeclarator > ArrowFunctionExpression'],
          require: {
            ClassDeclaration: true,
            ClassExpression: true,
          },
        },
      ],
    },
  },
]
