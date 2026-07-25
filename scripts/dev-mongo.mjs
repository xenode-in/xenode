/**
 * Ephemeral local MongoDB for development.
 *
 * Spins up an in-memory MongoDB (via mongodb-memory-server, already a dev
 * dependency) bound to 127.0.0.1:27017 so the apps' default
 * `MONGODB_URI=mongodb://localhost:27017/xnode` connects with zero install.
 *
 *   npm run dev:mongo
 *
 * Notes:
 *  - Data is EPHEMERAL — it resets every time this process restarts. Great for
 *    a clean-slate dev loop; not for anything you want to keep.
 *  - First run downloads a mongod binary into the mongodb-memory-server cache.
 *  - For a persistent DB, install MongoDB Community (or run it via Docker) and
 *    skip this script — the apps only care that something answers on :27017.
 *
 * Stop with Ctrl+C.
 */
import { MongoMemoryServer } from "mongodb-memory-server";

const PORT = Number(process.env.DEV_MONGO_PORT || 27017);

async function main() {
  console.log(`[dev-mongo] starting ephemeral MongoDB on 127.0.0.1:${PORT} …`);
  let server;
  try {
    server = await MongoMemoryServer.create({
      instance: { port: PORT, ip: "127.0.0.1" },
    });
  } catch (error) {
    console.error(
      `[dev-mongo] failed to start on :${PORT}. Is something already ` +
        `listening there (an existing mongod, or a previous dev:mongo)?`,
    );
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log(`[dev-mongo] ready → ${server.getUri()}`);
  console.log("[dev-mongo] data is ephemeral; Ctrl+C to stop.");

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\n[dev-mongo] stopping …");
    await server.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the event loop alive until interrupted.
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error("[dev-mongo] unexpected error:", error);
  process.exit(1);
});
