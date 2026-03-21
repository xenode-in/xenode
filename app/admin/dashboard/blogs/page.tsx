"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Calendar, FolderOpen, PenSquare, Loader2, Trash2, AlertTriangle } from "lucide-react";

interface BlogEntry {
  slug: string;
  title: string;
  date: string;
  folder?: string;
}

export default function AdminBlogsPage() {
  const [posts, setPosts] = useState<BlogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Deletion state
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, []);

  function fetchPosts() {
    setLoading(true);
    fetch("/api/admin/blogs")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPosts(data.posts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function handleDelete() {
    if (!deletingSlug) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/blogs?slug=${deletingSlug}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      
      setPosts(posts.filter(p => p.slug !== deletingSlug));
      setDeletingSlug(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Blog Posts</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Manage and create blog posts.
          </p>
        </div>
        <Link
          href="/admin/dashboard/blogs/create"
          className="flex items-center gap-2 px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-100 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Post
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading posts…
        </div>
      )}

      {error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {!loading && !error && posts.length === 0 && (
        <div className="text-center py-24 rounded-xl border border-zinc-800 bg-zinc-900/50">
          <PenSquare className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">No blog posts yet.</p>
          <Link
            href="/admin/dashboard/blogs/create"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create your first post
          </Link>
        </div>
      )}

      {!loading && !error && posts.length > 0 && (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.slug}
              className="flex items-center justify-between p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {post.folder && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-full capitalize">
                      <FolderOpen className="w-3 h-3" />
                      {post.folder}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-white">{post.title}</p>
                <p className="flex items-center gap-1 text-xs text-zinc-500 mt-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(post.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/dashboard/blogs/edit/${post.slug}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                >
                  Edit
                </Link>
                <Link
                  href={`/blog/${post.slug}`}
                  target="_blank"
                  className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  View
                </Link>
                <button
                  onClick={() => setDeletingSlug(post.slug)}
                  className="p-1.5 rounded-lg border border-transparent text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Modal */}
      {deletingSlug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4 text-red-400">
              <div className="p-2 bg-red-400/10 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-white">Delete Post?</h2>
            </div>
            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
              Are you sure you want to delete <span className="text-zinc-200 font-medium whitespace-nowrap overflow-hidden text-ellipsis inline-block max-w-[200px] align-bottom">"{posts.find(p => p.slug === deletingSlug)?.title}"</span>? This action cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <button
                disabled={deleteLoading}
                onClick={() => setDeletingSlug(null)}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
              >
                Cancel
              </button>
              <button
                disabled={deleteLoading}
                onClick={handleDelete}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center justify-center"
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
