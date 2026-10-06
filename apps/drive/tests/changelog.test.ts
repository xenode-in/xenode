import { describe, expect, it } from "vitest";
import { getAllChangelogEntries, getChangelogBySlug } from "@/lib/changelog";

describe("changelog front matter", () => {
  it("reads each entry's YAML front matter and body", () => {
    const entry = getChangelogBySlug("2026-01-15-project-kickoff");
    expect(entry).toMatchObject({
      title: "Building in Public",
      date: "2026-01-15",
      tag: "Announcement",
    });
    expect(entry?.content.trimStart()).toMatch(/^Welcome to the Xenode changelog\./);
    expect(entry?.content).not.toContain("title:");
    expect(getAllChangelogEntries().map((meta) => meta.slug)).toContain(
      "2026-01-15-project-kickoff",
    );
  });
});
