import base from "@erp/config/eslint";

export default [
  ...base,
  {
    // NestJS resolves constructor dependencies from emitted decorator metadata, which needs real
    // (value) imports. Auto-converting them to `import type` would silently break injection.
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
];
