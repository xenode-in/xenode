import mongoose from "mongoose";

let logsConnection: mongoose.Connection | null = null;
let logsConnectionPromise: Promise<mongoose.Connection> | null = null;

export async function connectLogsDatabase(
  uri = process.env.MONGODB_LOGS_URI ??
    "mongodb://mongo-logs:27017/Xenode-logs",
): Promise<mongoose.Connection> {
  if (logsConnection?.readyState === 1) return logsConnection;
  if (!logsConnectionPromise) {
    logsConnectionPromise = mongoose
      .createConnection(uri)
      .asPromise()
      .then((connection) => {
        logsConnection = connection;
        return connection;
      })
      .catch((error) => {
        logsConnectionPromise = null;
        throw error;
      });
  }
  return logsConnectionPromise;
}
