import "./env";
import mongoose from "mongoose";
import { createScanWorker } from "./scan-processor";
import { createFileWorker } from "./file-processor";

async function startWorkers() {
  console.log("Connecting to MongoDB...");
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  console.log("Starting BullMQ Workers...");
  const scanWorker = createScanWorker();
  const fileWorker = createFileWorker();

  scanWorker.on("completed", (job) => {
    console.log(`Scan job ${job.id} completed`);
  });

  scanWorker.on("failed", (job, err) => {
    console.error(`Scan job ${job?.id} failed:`, err);
  });

  fileWorker.on("completed", (job) => {
    console.log(`File job ${job.id} completed`);
  });

  fileWorker.on("failed", (job, err) => {
    console.error(`File job ${job?.id} failed:`, err);
  });

  console.log("Workers started successfully.");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down workers...");
    await scanWorker.close();
    await fileWorker.close();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startWorkers().catch(console.error);
