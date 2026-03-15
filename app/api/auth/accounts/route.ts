import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import dbConnect from "@/lib/mongodb";
import { MongoClient } from "mongodb";

import { ObjectId } from "mongodb";

export async function GET() {
  try {
    await dbConnect();
    
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch accounts directly from mongodb since BetterAuth client session doesn't include it by default
    const mongoClient = new MongoClient(process.env.MONGODB_URI!);
    await mongoClient.connect();
    const db = mongoClient.db();
    const accountCol = db.collection("account");
    
    // Convert string ID to ObjectId for raw mongodb driver query
    let userObjectId;
    try {
      userObjectId = new ObjectId(session.user.id);
    } catch {
      userObjectId = session.user.id; // Fallback just in case BetterAuth changes IDs to strings natively
    }

    const accounts = await accountCol.find({ userId: userObjectId }).toArray();
    await mongoClient.close();

    return NextResponse.json(accounts);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch accounts" }, { status: 500 });
  }
}
