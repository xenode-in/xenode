import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { applyRuntimeKills, getEnvironmentRendererFlags } from "@/lib/file-security/flags";
import FileRendererConfig from "@/models/FileRendererConfig";

export const dynamic = "force-dynamic";

const FAIL_CLOSED = {
  global: false,
  pdf: false,
  office: false,
  svg: false,
  html: false,
  image: false,
  media: false,
  archive: false,
  text: false,
  onlyOfficeV2: false,
} as const;

export async function GET() {
  try {
    await dbConnect();
    const config = await FileRendererConfig.findOne({ key: "global" }).lean();
    const renderers = applyRuntimeKills(
      getEnvironmentRendererFlags(),
      config?.killed ?? {},
    );
    return NextResponse.json(
      {
        version: config?.version ?? 1,
        renderers,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { version: 0, renderers: FAIL_CLOSED, expiresAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
