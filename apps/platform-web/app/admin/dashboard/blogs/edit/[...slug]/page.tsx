"use client";

import { useEffect, useState, use } from "react";
import BlogForm from "@/components/admin/BlogForm";
import { Loader2 } from "lucide-react";

export default function EditBlogPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params);
  const slugPath = slug.join("/");

  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugPath) return;

    fetch(`/api/admin/blogs?slug=${slugPath}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPost(data.blog);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slugPath]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-zinc-500 gap-4">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Loading post data…</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="p-8 text-center text-red-400">
        <p>{error || "Post not found."}</p>
      </div>
    );
  }

  return (
    <BlogForm
      mode="edit"
      initialData={{
        slug: post.slug,
        title: post.title,
        description: post.description,
        author: post.author,
        tags: post.tags,
        content: post.content,
        image: post.image,
        folder: post.folder,
      }}
    />
  );
}
