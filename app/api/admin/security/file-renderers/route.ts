import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import dbConnect from "@/lib/mongodb";
import { requireSuperAdminSession } from "@/lib/admin/session";
import { applyRuntimeKills, getEnvironmentRendererFlags } from "@/lib/file-security/flags";
import { RENDERER_KEYS } from "@/lib/file-security/types";
import FileRendererConfig from "@/models/FileRendererConfig";
import FileRendererConfigEvent from "@/models/FileRendererConfigEvent";

export const dynamic = "force-dynamic";

const rendererSchema = z.enum(["global", ...RENDERER_KEYS]);
const updateSchema = z
  .object({
    renderer: rendererSchema,
    killed: z.boolean(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

async function requireSuperAdmin() {
  try {
    return await requireSuperAdminSession();
  } catch (error) {
    const status = error instanceof Error && error.message === "Forbidden" ? 403 : 401;
    throw new Response("Unauthorized", { status });
  }
}

export async function GET() {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (response) {
    return response as Response;
  }
  void session;
  await dbConnect();
  const config = await FileRendererConfig.findOne({ key: "global" }).lean();
  const environment = getEnvironmentRendererFlags();
  return NextResponse.json({
    environment,
    killed: config?.killed ?? {},
    effective: applyRuntimeKills(environment, config?.killed ?? {}),
    version: config?.version ?? 1,
    reason: config?.reason ?? "Initial fail-closed state",
    updatedAt: config?.updatedAt ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (response) {
    return response as Response;
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid renderer update", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await dbConnect();
  const { renderer, killed, reason } = parsed.data;
  const config = await FileRendererConfig.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        [`killed.${renderer}`]: killed,
        reason,
        updatedByAdminId: session.id,
        updatedByUsername: session.username,
      },
      $inc: { version: 1 },
      $setOnInsert: { key: "global" },
    },
    { new: true, upsert: true },
  ).lean();

  await FileRendererConfigEvent.create({
    renderer,
    killed,
    reason,
    actorAdminId: session.id,
    actorUsername: session.username,
    configVersion: config.version,
  });

  const environment = getEnvironmentRendererFlags();
  return NextResponse.json({
    environment,
    killed: config.killed,
    effective: applyRuntimeKills(environment, config.killed),
    version: config.version,
    reason: config.reason,
    updatedAt: config.updatedAt,
  });
}
