import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Waitlist from "@/models/Waitlist";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { success: false, message: "Email is required" },
        { status: 400 },
      );
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, message: "Please enter a valid email address" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Check if email already exists
    const existingEntry = await Waitlist.findOne({
      email: email.toLowerCase(),
    });
    if (existingEntry) {
      return NextResponse.json(
        { success: true, message: "You're already on the waitlist!" },
        { status: 200 },
      );
    }

    // Create new waitlist entry
    await Waitlist.create({ email: email.toLowerCase() });

    return NextResponse.json(
      { success: true, message: "Successfully joined the waitlist!" },
      { status: 201 },
    );
  } catch (error) {
    console.error("Waitlist API error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    await dbConnect();

    const count = await Waitlist.countDocuments();

    return NextResponse.json({ success: true, count }, { status: 200 });
  } catch (error) {
    console.error("Waitlist GET error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 },
    );
  }
}
