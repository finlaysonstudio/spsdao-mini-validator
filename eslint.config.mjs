import jaypie from "@jaypie/eslint";
import tsParser from "@typescript-eslint/parser";

export default [
  ...jaypie,
  {
    files: ["**/*.mts"],
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    files: ["**/public/**/*.mjs"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        window: "readonly",
        console: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        Map: "readonly",
        JSON: "readonly",
        Date: "readonly",
      },
    },
  },
  {
    ignores: ["scripts/**"],
  },
];
