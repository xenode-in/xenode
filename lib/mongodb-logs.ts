import mongoose from "mongoose";

const LOGS_URI =
  process.env.MONGODB_LOGS_URI || "mongodb://mongo-logs:27017/xnode-logs";

let logsConnection: mongoose.Connection | null = null;

/**
 * Returns a dedicated Mongoose connection for the xnode-logs database.
 * Kept separate from the production DB so analytics writes never
 * compete with user-facing queries.
 */
export async function connectLogsDB(): Promise<mongoose.Connection> {
  if (logsConnection && logsConnection.readyState === 1) {
    return logsConnection;
  }
  logsConnection = await mongoose.createConnection(LOGS_URI).asPromise();
  return logsConnection;
}
