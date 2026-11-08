import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import react from "eslint-plugin-react-x";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  globalIgnores(["build/", "coverage/", "dist/"]),
  js.configs.recommended,
  {
    files: ["*.config.js", "scripts/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-x": react, "react-hooks": reactHooks },
    rules: {
      "react-x/no-duplicate-key": "error",
      "react-x/no-missing-key": "error",
      "react-x/no-direct-mutation-state": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
