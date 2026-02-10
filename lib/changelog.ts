import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CHANGELOG_PATH = path.join(process.cwd(), "content/changelog");

export interface ChangelogEntry {
  slug: string;
  title: string;
  date: string;
  tag: string; // e.g. "Feature", "Improvement", "Infrastructure", "Update"
  summary: string;
  image?: string; // optional hero image path
  content: string;
}

export interface ChangelogEntryMeta {
  slug: string;
  title: string;
  date: string;
  tag: string;
  summary: string;
  image?: string;
}

/**
 * Group changelog entries by month-year for the timeline layout
 */
export interface ChangelogGroup {
  label: string; // e.g. "February 2026"
  entries: ChangelogEntryMeta[];
}

export function getAllChangelogEntries(): ChangelogEntryMeta[] {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    fs.mkdirSync(CHANGELOG_PATH, { recursive: true });
    return [];
  }

  const files = fs
    .readdirSync(CHANGELOG_PATH)
    .filter((file) => file.endsWith(".mdx"));

  const entries = files.map((file) => {
    const filePath = path.join(CHANGELOG_PATH, file);
    const source = fs.readFileSync(filePath, "utf-8");
    const { data } = matter(source);
    const slug = file.replace(".mdx", "");

    return {
      slug,
      title: data.title || "Untitled",
      date: data.date || new Date().toISOString(),
      tag: data.tag || "Update",
      summary: data.summary || "",
      image: data.image || undefined,
    };
  });

  return entries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function getChangelogBySlug(slug: string): ChangelogEntry | null {
  const filePath = path.join(CHANGELOG_PATH, `${slug}.mdx`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(source);

  return {
    slug,
    title: data.title || "Untitled",
    date: data.date || new Date().toISOString(),
    tag: data.tag || "Update",
    summary: data.summary || "",
    image: data.image || undefined,
    content,
  };
}

export function getGroupedChangelog(): ChangelogGroup[] {
  const entries = getAllChangelogEntries();
  const groups: Map<string, ChangelogEntryMeta[]> = new Map();

  entries.forEach((entry) => {
    const date = new Date(entry.date);
    const label = date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(entry);
  });

  return Array.from(groups.entries()).map(([label, entries]) => ({
    label,
    entries,
  }));
}
