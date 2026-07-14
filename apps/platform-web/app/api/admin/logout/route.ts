import { NextResponse } from "next/server";
import { destroyAdminSession } from "@/lib/admin/session";

export async function POST() {
  await destroyAdminSession();
  return NextResponse.json({ success: true });
}
