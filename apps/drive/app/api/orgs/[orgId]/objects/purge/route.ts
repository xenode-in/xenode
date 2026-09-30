import { NextRequest } from "next/server";
import { organizationSpaceId } from "@xenode/spaces/ids";
import { requireAccessContext, isAuthzError, toJsonResponse } from "@/lib/authz";
import { handleBinMutation } from "@/lib/storage/bin";
import { revisionError } from "@/lib/storage/revision-upload";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const url = new URL(request.url); url.searchParams.set("spaceId", organizationSpaceId(orgId));
    const headers = new Headers(request.headers); headers.set("x-xenode-space-id", organizationSpaceId(orgId));
    const scoped = new NextRequest(url, { method: request.method, headers });
    return await handleBinMutation(request, await requireAccessContext(scoped, "delete"), "purge", true);
  } catch (error) { return isAuthzError(error) ? toJsonResponse(error) : revisionError(error); }
}
