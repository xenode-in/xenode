import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Admin from "@/models/Admin";
import bcrypt from "bcryptjs";
import { z } from "zod";

const CreateAdminSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-z0-9_]+$/, "lowercase alphanumeric and underscores only"),
  password: z.string().min(8),
  role: z.enum(["admin", "super_admin"]).default("admin"),
});

// GET: list all admins (super_admin only)
export async function GET() {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await dbConnect();

  const admins = await Admin.find({}, "-passwordHash").sort({ createdAt: -1 }).lean();

  return NextResponse.json({
    admins: admins.map((a) => ({
      id: a._id.toString(),
      username: a.username,
      role: a.role,
      isActive: a.isActive,
      createdBy: a.createdBy,
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt,
    })),
  });
}

// POST: create new admin (super_admin only)
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await dbConnect();

  const body = await req.json();
  const parsed = CreateAdminSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { username, password, role } = parsed.data;

  const existing = await Admin.findOne({ username });
  if (existing) {
    return NextResponse.json(
      { error: "Username already taken" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await Admin.create({
    username,
    passwordHash,
    role,
    createdBy: session.username,
    isActive: true,
  });

  return NextResponse.json({
    success: true,
    admin: {
      id: admin._id.toString(),
      username: admin.username,
      role: admin.role,
      createdBy: admin.createdBy,
      createdAt: admin.createdAt,
    },
  });
}
