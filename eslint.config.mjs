import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Static assets are not app source — never lint them. The vendored ONLYOFFICE
    // engine alone is ~16k files (incl. multi-MB minified bundles) and OOMs ESLint.
    "public/**",
  ]),
]);

export default eslintConfig;
