// eslint.config.js — ESLint v9 flat config
// Replaces .eslintrc.json for ESLint v9+ compatibility.

const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const typescriptParser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "writable",
        exports: "writable",
        console: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "no-console": "warn",
    },
  },
  {
    ignores: ["cdk.out/**", "node_modules/**", "dist/**", "**/*.js"],
  },
];
