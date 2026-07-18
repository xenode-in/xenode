import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import dbConnect from "@/lib/mongodb";
import Blog from "@/models/Blog";
import { getAdminSession } from "@/lib/admin/session";

const POSTS_PATH = path.join(process.cwd(), "content/blog");

function getAllMdxFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllMdxFiles(filePath, fileList);
    } else if (file.endsWith(".mdx")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

export async function POST() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const files = getAllMdxFiles(POSTS_PATH);
  const results = {
    total: files.length,
    success: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, "utf-8");
      const { data, content } = matter(source);
      
      const relativePath = path.relative(POSTS_PATH, filePath);
      const slug = relativePath.split(path.sep).join("/").replace(/\.mdx$/, "");
      
      const parts = slug.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;

      // Upsert into MongoDB
      await Blog.findOneAndUpdate(
        { slug },
        {
          slug,
          title: data.title || "Untitled",
          description: data.description || "",
          date: data.date ? new Date(data.date) : new Date(),
          author: data.author || "Xenode Team",
          tags: data.tags || [],
          content: content,
          image: data.image || undefined,
          folder,
          readingTime: readingTime(content).text,
        },
        { upsert: true, new: true }
      );

      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push(`${filePath}: ${error.message}`);
    }
  }

  return NextResponse.json(results);
}
