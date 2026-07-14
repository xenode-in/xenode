import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Admin from "@/models/Admin";
import { z } from "zod";

const UpdateAdminSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(["admin", "super_admin"]).optional(),
});

// PATCH: update admin (super_admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ adminId: string }> }
) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { adminId } = await params;
  await dbConnect();

  const body = await req.json();
  const parsed = UpdateAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = await Admin.findByIdAndUpdate(
    adminId,
    { $set: parsed.data },
    { new: true, select: "-passwordHash" }
  );

  if (!admin) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, admin });
}

// DELETE: remove admin (super_admin only, cannot delete self)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ adminId: string }> }
) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { adminId } = await params;
  await dbConnect();

  const admin = await Admin.findById(adminId);
  if (!admin) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  if (admin.username === session.username) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  await Admin.findByIdAndDelete(adminId);
  return NextResponse.json({ success: true });
}
