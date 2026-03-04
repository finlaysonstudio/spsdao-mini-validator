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
];
