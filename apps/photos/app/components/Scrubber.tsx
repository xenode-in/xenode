"use client";

import type { TimelineGroup } from "./Timeline";

export function Scrubber({
  groups,
  onChange,
}: {
  groups: TimelineGroup[];
  onChange(label: string): void;
}) {
  const unique = groups.filter(
    (group, index) =>
      index === 0 || group.shortLabel !== groups[index - 1]?.shortLabel,
  );

  if (unique.length < 2) return null;

  return (
    <aside
      className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] w-20 shrink-0 overflow-y-auto py-2 xl:block"
      aria-label="Photos timeline"
    >
      <div className="relative space-y-1 border-l border-border pl-3">
        {unique.map((group) => (
          <button
            key={group.label}
            type="button"
            onClick={() => onChange(group.label)}
            className="relative block w-full rounded-md px-1.5 py-1 text-left text-[10px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <span className="absolute -left-[15.5px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-border transition group-hover:bg-primary" />
            {group.shortLabel}
          </button>
        ))}
      </div>
    </aside>
  );
}
