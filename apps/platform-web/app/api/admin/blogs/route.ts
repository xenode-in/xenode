import { NextRequest, NextResponse } from "next/server";
import readingTime from "reading-time";
import dbConnect from "@/lib/mongodb";
import Blog from "@/models/Blog";
import { getAdminSession } from "@/lib/admin/session";
import { uploadObject } from "@/lib/b2/objects";
import { getPublicB2Url } from "@/lib/b2/cdn";
import { getPublicS3Client } from "@/lib/b2/client";

const PUBLIC_BUCKET_NAME = process.env.PUBLIC_S3_BUCKET || "xenopublic";
const GLOBAL_BUCKET_NAME = process.env.S3_BUCKET_NAME || "xenode-drive-storage";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");

  await dbConnect();

  if (slug) {
    const blog = await Blog.findOne({ slug }).lean();
    if (!blog) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    return NextResponse.json({ blog });
  }

  const blogs = await Blog.find({}, { slug: 1, title: 1, date: 1, folder: 1 })
    .sort({ date: -1 })
    .lean();

  const formattedPosts = blogs.map((blog: any) => ({
    slug: blog.slug,
    title: blog.title,
    date: blog.date.toISOString(),
    folder: blog.folder,
  }));

  return NextResponse.json({ posts: formattedPosts });
}

export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const originalSlug = formData.get("originalSlug") as string;

    if (!originalSlug) {
      return NextResponse.json(
        { error: "Original slug is required" },
        { status: 400 },
      );
    }

    const title = (formData.get("title") as string | null)?.trim();
    const description =
      (formData.get("description") as string | null)?.trim() ?? "";
    const content = (formData.get("content") as string | null)?.trim() ?? "";
    const author =
      (formData.get("author") as string | null)?.trim() ?? "Xenode Team";
    const folder = (formData.get("folder") as string | null)?.trim() ?? "";
    const tagsRaw = (formData.get("tags") as string | null)?.trim() ?? "";
    const imageFile = formData.get("image") as File | null;
    const existingImage = formData.get("existingImage") as string | null;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const baseSlug = slugify(title);
    const newSlug = folder ? `${slugify(folder)}/${baseSlug}` : baseSlug;

    await dbConnect();

    // Handle tags
    const tags = tagsRaw
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    let imageUrl = existingImage || "";
    if (imageFile && imageFile.size > 0) {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const filename = `${Date.now()}-${slugify(imageFile.name.replace(/\.[^.]+$/, ""))}.${imageFile.name.split(".").pop()}`;
      const key = `blog/${filename}`;

      // Upload to Public Storage (Zata.ai)
      await uploadObject(
        PUBLIC_BUCKET_NAME,
        key,
        buffer,
        imageFile.type,
        imageFile.size,
        getPublicS3Client(),
      );

      // Generate URL
      imageUrl = getPublicB2Url(PUBLIC_BUCKET_NAME, key);
    }

    const readStats = readingTime(content);

    const updatedBlog = await Blog.findOneAndUpdate(
      { slug: originalSlug },
      {
        slug: newSlug,
        title,
        description,
        content,
        author,
        folder: folder ? slugify(folder) : undefined,
        tags,
        image: imageUrl || undefined,
        readingTime: readStats.text,
      },
      { new: true },
    );

    if (!updatedBlog) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, slug: newSlug });
  } catch (err: any) {
    console.error("[PUT /api/admin/blogs]", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 });
    }

    await dbConnect();
    const result = await Blog.findOneAndDelete({ slug });

    if (!result) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/admin/blogs]", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();

    const title = (formData.get("title") as string | null)?.trim();
    const description =
      (formData.get("description") as string | null)?.trim() ?? "";
    const content = (formData.get("content") as string | null)?.trim() ?? "";
    const author =
      (formData.get("author") as string | null)?.trim() ?? "Xenode Team";
    const folder = (formData.get("folder") as string | null)?.trim() ?? "";
    const tagsRaw = (formData.get("tags") as string | null)?.trim() ?? "";
    const imageFile = formData.get("image") as File | null;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const baseSlug = slugify(title);
    const slug = folder ? `${slugify(folder)}/${baseSlug}` : baseSlug;

    await dbConnect();

    const existing = await Blog.findOne({ slug });
    if (existing) {
      return NextResponse.json(
        { error: `A post with slug "${slug}" already exists.` },
        { status: 409 },
      );
    }

    const tags = tagsRaw
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    let imageUrl = "";
    if (imageFile && imageFile.size > 0) {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const filename = `${Date.now()}-${slugify(imageFile.name.replace(/\.[^.]+$/, ""))}.${imageFile.name.split(".").pop()}`;
      const key = `blog/${filename}`;

      await uploadObject(
        PUBLIC_BUCKET_NAME,
        key,
        buffer,
        imageFile.type,
        imageFile.size,
        getPublicS3Client(),
      );
      imageUrl = getPublicB2Url(PUBLIC_BUCKET_NAME, key);
    }

    const readStats = readingTime(content);

    const blog = new Blog({
      slug,
      title,
      description,
      content,
      author,
      folder: folder ? slugify(folder) : undefined,
      tags,
      image: imageUrl || undefined,
      readingTime: readStats.text,
      date: new Date(),
    });

    await blog.save();

    return NextResponse.json({ success: true, slug }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/admin/blogs]", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}
