import * as dotenv from "dotenv";
import * as path from "path";

if (!process.env.MONGODB_URI) {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
}
