// Shared ESLint flat config. Apps/packages re-export it (optionally extending with react rules).
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export const base = tseslint.config(
  { ignores: ["dist/**", "coverage/**", "**/*.gen.ts", "**/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "Use @erp/domain money helpers — never parse money as a float (ADR-0002).",
        },
      ],
    },
  },
  prettier,
);

export const react = tseslint.config(...base, {
  languageOptions: { globals: { ...globals.browser } },
  plugins: { "react-hooks": reactHooks },
  rules: reactHooks.configs.recommended.rules,
});

export default base;
