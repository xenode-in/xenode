/**
 * PATCH  /api/admin/coupons/[id]  — update coupon (toggle active, edit fields)
 * DELETE /api/admin/coupons/[id]  — delete coupon
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Coupon from "@/models/Coupon";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  await dbConnect();
  const coupon = await Coupon.findByIdAndUpdate(id, { $set: body }, { new: true }).lean();
  if (!coupon) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ coupon });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await dbConnect();
  await Coupon.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}
