import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "unused-imports/no-unused-imports": "error",
      "@stylistic/semi": ["error", "never"],
    },
  },
];

export default eslintConfig;
