import { NextRequest } from "next/server";
import { requireAccessContext, isAuthzError, toJsonResponse } from "@/lib/authz";
import { handleBinMutation } from "@/lib/storage/bin";
import { revisionError } from "@/lib/storage/revision-upload";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try { return await handleBinMutation(request, await requireAccessContext(request, "write"), "restore"); }
  catch (error) { return isAuthzError(error) ? toJsonResponse(error) : revisionError(error); }
}
