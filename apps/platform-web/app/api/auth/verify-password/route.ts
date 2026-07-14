import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import { verifyStoredPasswordHash } from "@/lib/auth/password";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const { password } = await request.json();

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    const account = await mongoose.connection.db?.collection("account").findOne(
      {
        userId: new mongoose.Types.ObjectId(session.user.id),
        providerId: "credential",
      },
      {
        projection: {
          password: 1,
        },
      },
    );

    if (!account?.password || typeof account.password !== "string") {
      return NextResponse.json(
        { error: "Password authentication is not available for this account" },
        { status: 400 },
      );
    }

    const valid = verifyStoredPasswordHash(password, account.password);

    if (!valid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    return NextResponse.json({ valid: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Verify password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
