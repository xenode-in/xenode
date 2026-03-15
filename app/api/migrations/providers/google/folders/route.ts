import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { MongoClient, ObjectId } from "mongodb";
import { ProviderFactory } from "@/lib/migrations/providers/ProviderFactory";
import { ProviderType } from "@/models/MigrationJob";

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    if (!accountId) {
      return NextResponse.json({ error: "accountId required" }, { status: 400 });
    }

    const mongoClient = new MongoClient(process.env.MONGODB_URI!);
    await mongoClient.connect();
    const db = mongoClient.db();
    const accountCol = db.collection("account");
    const account = await accountCol.findOne({
      accountId: accountId,
    });
    await mongoClient.close();

    if (!account || !account.accessToken) {
      return NextResponse.json({ error: "Account not found or no token" }, { status: 404 });
    }

    const adapter = ProviderFactory.getAdapter(
      ProviderType.GOOGLE_DRIVE,
      account.accessToken as string
    );

    // Fetch root folders
    const result = await adapter.listFiles("root");
    const foldersOnly = result.files.filter(f => f.isFolder);

    return NextResponse.json(foldersOnly);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch folders" }, { status: 500 });
  }
}
