import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import mongoose from "mongoose";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    await dbConnect();

    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: "DB not connected" }, { status: 500 });
    }

    const userCollection = db.collection("user");
    const existingUser = await userCollection.findOne({ email: email.toLowerCase().trim() });

    return NextResponse.json({ exists: !!existingUser });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check email" }, { status: 500 });
  }
}