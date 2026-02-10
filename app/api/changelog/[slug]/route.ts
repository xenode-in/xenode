import { NextResponse } from "next/server";
import { getChangelogBySlug } from "@/lib/changelog";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const entry = getChangelogBySlug(slug);

  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Convert markdown content to HTML
  const result = await remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false })
    .process(entry.content);

  return NextResponse.json({
    ...entry,
    content: result.toString(),
  });
}
