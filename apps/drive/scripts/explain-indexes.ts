/**
 * scripts/explain-indexes.ts
 *
 * Explain-plan regression guard for Xenode MongoDB indexes.
 *
 * Runs explain("executionStats") for each hot query across all 5 collections
 * and verifies that the winning plan uses an IXSCAN (not a COLLSCAN).
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/explain-indexes.ts
 *
 * Exits with code 1 if any query uses COLLSCAN.
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local from project root
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Models (import after env is loaded) ────────────────────────────────────
import ApiKey from "../models/ApiKey";
import Bucket from "../models/Bucket";
import StorageObject from "../models/StorageObject";
import Usage from "../models/Usage";
import Waitlist from "../models/Waitlist";

// ── Types ──────────────────────────────────────────────────────────────────
interface ExplainResult {
  queryPlanner: {
    winningPlan: { stage: string; inputStage?: { stage: string } };
  };
  executionStats: {
    nReturned: number;
    totalDocsExamined: number;
    totalKeysExamined: number;
    executionTimeMillis: number;
  };
}

interface CheckResult {
  label: string;
  stage: string;
  nReturned: number;
  docsExamined: number;
  keysExamined: number;
  ms: number;
  passed: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Recursively find the leaf-most stage name (skips FETCH, PROJECTION, etc.) */
function leafStage(plan: {
  stage: string;
  inputStage?: { stage: string };
}): string {
  if (plan.inputStage)
    return leafStage(
      plan.inputStage as { stage: string; inputStage?: { stage: string } },
    );
  return plan.stage;
}

async function runExplain(
  label: string,
  query: mongoose.Query<unknown, unknown>,
): Promise<CheckResult> {
  const raw = (await (
    query as unknown as { explain: (v: string) => Promise<ExplainResult> }
  ).explain("executionStats")) as ExplainResult;

  const stats = raw.executionStats;
  const winningPlan = raw.queryPlanner.winningPlan;
  const stage = leafStage(winningPlan);

  const passed = stage === "IXSCAN";
  const ratio =
    stats.nReturned > 0
      ? (stats.totalDocsExamined / stats.nReturned).toFixed(1)
      : "N/A";

  const status = passed ? "✅ IXSCAN" : "❌ COLLSCAN";
  console.log(
    `  ${status}  ${label}` +
      `  (nReturned=${stats.nReturned}, docsExamined=${stats.totalDocsExamined}, ratio=${ratio}, ms=${stats.executionTimeMillis})`,
  );

  return {
    label,
    stage,
    nReturned: stats.nReturned,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    ms: stats.executionTimeMillis,
    passed,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌  MONGODB_URI is not set in .env.local");
    process.exit(1);
  }

  console.log("🔌  Connecting to MongoDB…");
  await mongoose.connect(uri);
  console.log("✅  Connected\n");

  // Use a synthetic userId that won't match real data — we only care about plan
  const FAKE_USER = "explain_plan_probe_user";
  const FAKE_BUCKET_ID = new mongoose.Types.ObjectId();
  const FAKE_ID = new mongoose.Types.ObjectId();

  console.log("📊  Running explain plans…\n");

  const results: CheckResult[] = [];

  // ── ApiKey ──────────────────────────────────────────────────────────────
  console.log("[ ApiKey ]");
  results.push(
    await runExplain(
      "find({userId}).sort({createdAt:-1})",
      ApiKey.find({ userId: FAKE_USER }).sort({ createdAt: -1 }),
    ),
  );
  results.push(
    await runExplain(
      "findOne({_id, userId})",
      ApiKey.findOne({ _id: FAKE_ID, userId: FAKE_USER }),
    ),
  );

  // ── Bucket ──────────────────────────────────────────────────────────────
  console.log("\n[ Bucket ]");
  results.push(
    await runExplain(
      "find({userId}).sort({createdAt:-1})",
      Bucket.find({ userId: FAKE_USER }).sort({ createdAt: -1 }),
    ),
  );
  results.push(
    await runExplain(
      "findOne({userId, name})",
      Bucket.findOne({ userId: FAKE_USER, name: "test-bucket" }),
    ),
  );
  results.push(
    await runExplain(
      "findOne({_id, userId})",
      Bucket.findOne({ _id: FAKE_BUCKET_ID, userId: FAKE_USER }),
    ),
  );

  // ── StorageObject ────────────────────────────────────────────────────────
  console.log("\n[ StorageObject ]");
  results.push(
    await runExplain(
      "find({bucketId}).sort({createdAt:-1})",
      StorageObject.find({ bucketId: FAKE_BUCKET_ID }).sort({ createdAt: -1 }),
    ),
  );
  results.push(
    await runExplain(
      "findOne({_id, userId})",
      StorageObject.findOne({ _id: FAKE_ID, userId: FAKE_USER }),
    ),
  );
  results.push(
    await runExplain(
      "findOne({bucketId, key})",
      StorageObject.findOne({ bucketId: FAKE_BUCKET_ID, key: "test/file.txt" }),
    ),
  );

  // ── Usage ────────────────────────────────────────────────────────────────
  console.log("\n[ Usage ]");
  results.push(
    await runExplain("findOne({userId})", Usage.findOne({ userId: FAKE_USER })),
  );

  // ── Waitlist ─────────────────────────────────────────────────────────────
  console.log("\n[ Waitlist ]");
  results.push(
    await runExplain(
      "findOne({email})",
      Waitlist.findOne({ email: "probe@explain.test" }),
    ),
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  const failures = results.filter((r) => !r.passed);
  console.log("\n────────────────────────────────────────");
  console.log(`Total queries checked : ${results.length}`);
  console.log(
    `Passed (IXSCAN)       : ${results.filter((r) => r.passed).length}`,
  );
  console.log(`Failed (COLLSCAN)     : ${failures.length}`);

  if (failures.length > 0) {
    console.log("\n❌  COLLSCAN detected on the following queries:");
    failures.forEach((f) => console.log(`   - ${f.label}`));
    console.log(
      "\nAdd a covering index for these queries and re-run this script.",
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("\n✅  All queries use index scans — no regressions detected.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
