import { globalIgnores } from "eslint/config";
import nextConfig from "../../packages/eslint-config/index.mjs";

const eslintConfig = [
  ...nextConfig,
  // Vendored third-party bundles served from public (the ONLYOFFICE client
  // and the metadata worker's exifr and mediainfo builds).
  globalIgnores([
    "public/internal-editors/**",
    "public/exifr/**",
    "public/mediainfo/**",
  ]),
];

export default eslintConfig;
