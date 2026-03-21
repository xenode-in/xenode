"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  X,
  Loader2,
  Eye,
  Edit3,
  CheckCircle2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote";
import { useMDXComponents } from "@/mdx-components";

const PRESET_FOLDERS = ["announcements", "support", "updates", "guides", "security"];

interface BlogFormProps {
  initialData?: {
    slug: string;
    title: string;
    description: string;
    author: string;
    tags: string[];
    content: string;
    image?: string;
    folder?: string;
  };
  mode: "create" | "edit";
}

export default function BlogForm({ initialData, mode }: BlogFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdxComponents = useMDXComponents({});

  const [form, setForm] = useState({
    title: initialData?.title || "",
    folder: initialData?.folder || "",
    customFolder: "",
    description: initialData?.description || "",
    author: initialData?.author || "Xenode Team",
    tags: initialData?.tags.join(", ") || "",
    content: initialData?.content || "",
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.image || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useCustomFolder, setUseCustomFolder] = useState(false);
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [mdxSource, setMdxSource] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Sync image preview if initialData changes (for lazy loading)
  useEffect(() => {
    if (initialData?.image) setImagePreview(initialData.image);
  }, [initialData?.image]);

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handlePreview() {
    if (activeTab === "preview") return;
    setActiveTab("preview");
    if (!form.content.trim()) {
      setMdxSource(null);
      return;
    }

    setPreviewLoading(true);
    try {
      const res = await fetch("/api/admin/blogs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: form.content }),
      });
      const data = await res.json();
      if (data.mdxSource) {
        setMdxSource(data.mdxSource);
      }
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    setLoading(true);
    setError(null);

    const folder = useCustomFolder
      ? form.customFolder.trim()
      : form.folder.trim();

    const fd = new FormData();
    fd.append("title", form.title);
    fd.append("folder", folder);
    fd.append("description", form.description);
    fd.append("author", form.author);
    fd.append("tags", form.tags);
    fd.append("content", form.content);
    
    if (mode === "edit") {
      fd.append("originalSlug", initialData!.slug);
      if (initialData?.image && !imageFile) {
        fd.append("existingImage", initialData.image);
      }
    }

    if (imageFile) fd.append("image", imageFile);

    try {
      const res = await fetch("/api/admin/blogs", { 
        method: mode === "create" ? "POST" : "PUT", 
        body: fd 
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push("/admin/dashboard/blogs");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors";
  const labelClass = "block text-xs font-medium text-zinc-400 mb-1.5";

  return (
    <div className="p-8 max-w-4xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/dashboard/blogs"
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-white">
              {mode === "create" ? "Create Blog Post" : "Edit Blog Post"}
            </h1>
            <p className="text-zinc-400 text-sm">
              {mode === "create" ? "Write and publish a new article." : "Update your existing article."}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setActiveTab("edit")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "edit" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editor
          </button>
          <button
            onClick={handlePreview}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "preview" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {activeTab === "edit" ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Left Column: Post Settings */}
            <div className="space-y-6 md:col-span-1">
              {/* Title */}
              <div>
                <label className={labelClass} htmlFor="title">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  id="title"
                  name="title"
                  type="text"
                  required
                  placeholder="How end-to-end encryption works"
                  value={form.title}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              {/* Folder */}
              <div>
                <label className={labelClass}>Folder / Category</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {PRESET_FOLDERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setUseCustomFolder(false);
                        setForm((prev) => ({ ...prev, folder: f }));
                      }}
                      className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors capitalize ${
                        !useCustomFolder && form.folder === f
                          ? "bg-white text-zinc-900 border-white"
                          : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-white"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setUseCustomFolder(true)}
                    className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                      useCustomFolder
                        ? "bg-white text-zinc-900 border-white"
                        : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    Custom…
                  </button>
                </div>
                {useCustomFolder && (
                  <input
                    name="customFolder"
                    type="text"
                    placeholder="e.g. deep-dives"
                    value={form.customFolder}
                    onChange={handleChange}
                    className={inputClass}
                  />
                )}
              </div>

              {/* Description */}
              <div>
                <label className={labelClass} htmlFor="description">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  placeholder="A short summary shown in the blog list"
                  value={form.description}
                  onChange={handleChange}
                  className={`${inputClass} resize-none`}
                />
              </div>

              {/* Author & Tags */}
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className={labelClass} htmlFor="author">
                    Author
                  </label>
                  <input
                    id="author"
                    name="author"
                    type="text"
                    value={form.author}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="tags">
                    Tags (comma-separated)
                  </label>
                  <input
                    id="tags"
                    name="tags"
                    type="text"
                    placeholder="security, privacy"
                    value={form.tags}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Cover Image */}
              <div>
                <label className={labelClass}>Cover Image</label>
                {imagePreview ? (
                  <div className="relative w-full h-40 rounded-xl overflow-hidden border border-zinc-800 group">
                    <Image
                      src={imagePreview}
                      alt="Cover preview"
                      fill
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center w-full h-32 rounded-xl border border-dashed border-zinc-800 hover:border-zinc-700 text-zinc-500 hover:text-zinc-400 transition-colors"
                  >
                    <Upload className="w-5 h-5 mb-1.5" />
                    <span className="text-[10px] uppercase font-semibold">Upload Image</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>
            </div>

            {/* Right Column: Content Editor */}
            <div className="md:col-span-2 space-y-2">
              <label className={labelClass} htmlFor="content">
                Content (MDX)
              </label>
              <textarea
                id="content"
                name="content"
                rows={25}
                placeholder={`# Introduction\n\nStart writing your amazing post here…`}
                value={form.content}
                onChange={handleChange}
                className={`${inputClass} font-mono resize-y p-4 text-[13px] leading-relaxed`}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-[600px] bg-zinc-900/50 rounded-2xl border border-zinc-800 p-8 md:p-12">
            {previewLoading ? (
              <div className="flex flex-col items-center justify-center h-96 text-zinc-500 gap-4">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-sm font-medium">Rendering MDX Preview…</p>
              </div>
            ) : mdxSource ? (
              <article className="prose prose-invert max-w-none prose-emerald">
                {/* Simulated Post Header in Preview */}
                <div className="mb-10 text-center">
                  <h1 className="text-4xl font-bold mb-4">{form.title}</h1>
                  <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 uppercase tracking-widest">
                    <span>{form.author}</span>
                    <span>•</span>
                    <span>{new Date().toLocaleDateString()}</span>
                  </div>
                </div>
                {imagePreview && (
                  <div className="relative w-full h-72 rounded-2xl overflow-hidden mb-12 border border-zinc-800">
                    <Image src={imagePreview} alt="Hero" fill className="object-cover" />
                  </div>
                )}
                <MDXRemote {...mdxSource} components={mdxComponents} />
              </article>
            ) : (
              <div className="flex flex-col items-center justify-center h-96 text-zinc-600">
                <p>No content to preview yet.</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Floating Actions */}
        <div className="fixed bottom-8 right-8 z-50 flex items-center gap-3">
          <Link
            href="/admin/dashboard/blogs"
            className="px-6 py-2.5 rounded-xl text-sm font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all shadow-xl"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-8 py-2.5 bg-white text-zinc-900 rounded-xl text-sm font-semibold hover:bg-zinc-100 transition-all shadow-xl disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {mode === "create" ? (loading ? "Publishing…" : "Publish Post") : (loading ? "Saving…" : "Save Changes")}
          </button>
        </div>
      </form>
    </div>
  );
}
