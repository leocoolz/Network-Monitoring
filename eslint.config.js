import js from "@eslint/js";

export const ignores = ["dist/**", "node_modules/**", ".vscode/**"];

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        document: "readonly",
        window: "readonly",
        Headers: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        MutationObserver: "readonly",
        CustomEvent: "readonly",
        requestAnimationFrame: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error"
    }
  }
];
