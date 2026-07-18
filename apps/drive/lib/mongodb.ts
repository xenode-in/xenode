import mongoose from "mongoose";
import { connectDatabase } from "@xenode/database/connection";

async function dbConnect(): Promise<typeof mongoose> {
  return connectDatabase();
}

export default dbConnect;
