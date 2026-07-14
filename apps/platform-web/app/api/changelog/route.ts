import { NextResponse } from "next/server";
import { getGroupedChangelog } from "@/lib/changelog";

export async function GET() {
  const groups = getGroupedChangelog();
  return NextResponse.json({ groups });
}
