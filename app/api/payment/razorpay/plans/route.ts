import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import { PricingConfig } from "@/models/PricingConfig";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      name,
      amount,
      period,
      interval = 1,
      currency = "INR",
      description,
    } = await req.json();

    const plan = await razorpay.plans.create({
      period, // monthly, yearly
      interval,
      item: {
        name,
        amount: Math.round(amount * 100),
        currency,
        description,
      },
    });

    // Optionally store plan_id in your PricingConfig or a new model
    // Here we'll just return it
    return NextResponse.json(plan);
  } catch (error: any) {
    console.error("Razorpay Plan Creation Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create plan" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const plans = await razorpay.plans.all();
    return NextResponse.json(plans);
  } catch (error: any) {
    console.error("Razorpay Plan Fetch Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch plans" },
      { status: 500 },
    );
  }
}
