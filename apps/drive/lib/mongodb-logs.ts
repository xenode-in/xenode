import mongoose from "mongoose";
import { connectLogsDatabase } from "@xenode/database/logs";
/**
 * Returns a dedicated Mongoose connection for the Xenode-logs database.
 * Kept separate from the production DB so analytics writes never
 * compete with user-facing queries.
 */
export async function connectLogsDB(): Promise<mongoose.Connection> {
  return connectLogsDatabase();
}
