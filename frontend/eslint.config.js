import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactYouMightNotNeedAnEffect from "eslint-plugin-react-you-might-not-need-an-effect";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "**/*.config.{js,ts}", "vite.config.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactYouMightNotNeedAnEffect.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React 19's new strict rules over-flag legitimate reset patterns
      // (setState in effect on prop change, refs assigned during render
      // for memoization). Downgrade to warning so they surface in lint
      // but don't fail CI; queued for a focused pass in
      // docs/refactor-next.md.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      // Test files use `mock.calls[0]![0]` style — already trusted by P1's
      // noUncheckedIndexedAccess fixes; do not duplicate as ESLint noise.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Project uses `_unused` prefix and intentional throwaway args.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
