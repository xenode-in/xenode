import dbConnect from "@/lib/mongodb";
import Blog from "@/models/Blog";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: string;
  content: string;
  image?: string;
  folder?: string;
}

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: string;
  image?: string;
  folder?: string;
}

export const BLOG_FOLDERS = [
  {
    slug: "announcements",
    title: "Announcements",
    description: "Stay up to date with the latest news and product updates.",
    image: "/blog/announcements.webp",
  },
  {
    slug: "support",
    title: "Support",
    description: "Helpful guides and resources to help you use Xenode.",
    image: "/blog/support.webp",
  },
  {
    slug: "updates",
    title: "Updates",
    description: "Technical changelogs and feature releases.",
    image: "/blog/updates.webp",
  },
  {
    slug: "guides",
    title: "Guides",
    description: "Step-by-step tutorials and deep dives.",
    image: "/blog/guides.webp",
  },
  {
    slug: "security",
    title: "Security",
    description: "Learn about how we keep your data safe.",
    image: "/blog/security.webp",
  },
];

export async function getAllPosts(): Promise<BlogPostMeta[]> {
  await dbConnect();
  const blogs = await Blog.find({}).sort({ date: -1 }).lean();

  return blogs.map((blog: any) => ({
    slug: blog.slug,
    title: blog.title,
    description: blog.description,
    date: blog.date.toISOString(),
    author: blog.author,
    tags: blog.tags,
    readingTime: blog.readingTime,
    image: blog.image,
    folder: blog.folder,
  }));
}

export async function getPostBySlug(
  slug: string | string[],
): Promise<BlogPost | null> {
  const slugPath = Array.isArray(slug) ? slug.join("/") : slug;
  await dbConnect();

  const blog = await Blog.findOne({ slug: slugPath }).lean();
  if (!blog) return null;

  return {
    slug: blog.slug,
    title: blog.title,
    description: blog.description,
    date: blog.date.toISOString(),
    author: blog.author,
    tags: blog.tags,
    readingTime: blog.readingTime,
    content: blog.content,
    image: blog.image,
    folder: blog.folder,
  };
}

export async function getAllSlugs(): Promise<string[]> {
  await dbConnect();
  const slugs = await Blog.find({}, { slug: 1 }).lean();
  return slugs.map((s: any) => s.slug);
}
