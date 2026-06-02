// Flat ESLint config for the Parvus Ordo monorepo.
//
// Next 16 removed `next lint`, so linting moved to ESLint directly. One config
// at the repo root lints the whole workspace in a single pass (`eslint .`).
//
// Deliberately MINIMAL (see CLAUDE.md "Scope discipline"): @eslint/js +
// typescript-eslint recommended, plus @next/eslint-plugin-next for the web app.
// The goal is a gate that catches real errors and *surfaces* style nits as
// warnings — not a max-strictness sweep that floods a never-linted codebase.
// Errors fail the gate; warnings don't, so the existing tree stays green while
// new problems get caught.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

export default tseslint.config(
  // Generated output, deps, and caches are never linted. Flat config does not
  // read .gitignore, so these mirror the ignored build artifacts there.
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
    ],
  },

  // Lint every JS/TS source extension in the repo (default is JS-only).
  { files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"] },

  // Base recommended sets. Non-type-checked tseslint keeps lint fast and
  // avoids the project-service setup — sufficient for a gate.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Runtime globals: Node for scripts/server code, browser for client
  // components. (Tests import vitest helpers explicitly, so no test globals.)
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // tsc already enforces undefined-symbol checks for typed files, and no-undef
  // false-positives on type-only references — turn it off for TS (kept on for
  // the plain .mjs scripts, which tsc does not check).
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: { "no-undef": "off" },
  },

  // Next.js rules — web app only.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // App Router project: there is no pages/ directory for this rule to scan.
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  // Minimal, sane tuning. Dead code and `any` are surfaced as warnings (not
  // errors) so the gate stays green on the existing tree while still flagging
  // them; `_`-prefixed args/vars are intentional throwaways.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
