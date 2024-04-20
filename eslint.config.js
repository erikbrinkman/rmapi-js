import eslint from "@eslint/js";
import configPrettier from "eslint-config-prettier";
import spellcheck from "eslint-plugin-spellcheck";
import tsdoc from "eslint-plugin-tsdoc";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  configPrettier,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      spellcheck,
      tsdoc,
    },
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "tsdoc/syntax": "error",
      "no-warning-comments": [
        "error",
        {
          terms: ["fixme"],
          location: "anywhere",
        },
      ],
      "spellcheck/spell-checker": [
        "error",
        {
          identifiers: false,
          skipWords: [
            "Markable",
            "authed",
            "bigints",
            "docid",
            "ebooks",
            "epub",
            "goog",
            "iife",
            "incrementing",
            "linux",
            "macos",
            "rmapi",
            "subfiles",
            "urls",
            "webcrypto",
          ],
          skipIfMatch: ["^[0-9a-f]{64}"],
          minLength: 4,
        },
      ],
    },
  },
);
