import { globalIgnores } from "eslint/config";
import nextConfig from "../../packages/eslint-config/index.mjs";

const eslintConfig = [
  ...nextConfig,
  // App-specific ignores (built ONLYOFFICE client assets live in public).
  globalIgnores(["public/internal-editors/**"]),
];

export default eslintConfig;
