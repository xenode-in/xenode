import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Admin from "@/models/Admin";
import { createAdminSession } from "@/lib/admin/session";
import { ensureSuperAdmin } from "@/lib/admin/ensureSuperAdmin";
import { z } from "zod";

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    await ensureSuperAdmin();
    await dbConnect();

    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { username, password } = parsed.data;

    const admin = await Admin.findOne({
      username: username.toLowerCase(),
      isActive: true,
    });

    if (!admin) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const valid = await admin.comparePassword(password);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Update last login
    admin.lastLoginAt = new Date();
    await admin.save();

    await createAdminSession({
      id: admin._id.toString(),
      username: admin.username,
      role: admin.role,
    });

    return NextResponse.json({
      success: true,
      admin: {
        id: admin._id.toString(),
        username: admin.username,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error("[Admin Login Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
