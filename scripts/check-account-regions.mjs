import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load MONGODB_URI from the root .env.local
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const uri = (env.match(/^MONGODB_URI=(.*)$/m) || [])[1]?.trim();
if (!uri) throw new Error("MONGODB_URI not found in root .env.local");

const { default: mongoose } = await import("mongoose");
await mongoose.connect(uri);
const profiles = await mongoose.connection
  .collection("accountProfiles")
  .find({}, { projection: { accountId: 1, storageRegion: 1, onboarded: 1 } })
  .toArray();

console.log(`accountProfiles: ${profiles.length}`);
for (const p of profiles) {
  console.log(
    `  acct=${String(p.accountId).slice(0, 10)}…  region=${p.storageRegion ?? "(unset → defaults asia)"}  onboarded=${p.onboarded ?? false}`,
  );
}
await mongoose.disconnect();
