import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import importPlugin from "eslint-plugin-import";
import security from "eslint-plugin-security";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "**/*.config.js",
      "**/*.config.ts",
      "**/*.config.cjs",
      "**/*.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      import: importPlugin,
      security,
    },
    settings: {
      react: { version: "18.0" },
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      // Entry-файлы (main.tsx) и роутер осознанно держат рядом маленькие
      // обёртки и объекты (router): выносить их ради fast refresh не нужно.
      "react-refresh/only-export-components": "off",
      ...importPlugin.configs.recommended.rules,
      ...security.configs.recommended.rules,
      "react/prop-types": "off",
      // Шумные эвристики eslint-plugin-security: дают ложные срабатывания
      // на обычном коде (obj[key], сравнение строк в тестах/моках).
      // Реальных уязвимостей не находят, только мусор в выводе lint.
      "security/detect-object-injection": "off",
      "security/detect-possible-timing-attacks": "off",
    },
  },
  {
    // Plain-JS files (mostly committed tsc emit next to .ts sources) carry
    // no type info: projectService is off here AND all type-aware rules are
    // downgraded via disableTypeChecked. Without the latter, rules like
    // @typescript-eslint/await-thenable still demand type info (inherited
    // from recommendedTypeChecked above) and crash the whole run.
    files: ["**/*.{js,jsx,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
);
