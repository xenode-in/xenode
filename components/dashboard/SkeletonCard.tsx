/**
 * SkeletonCard — ultra-lightweight grid-view placeholder rendered during fast scrolls.
 *
 * Replaces the full FileCard during active scrolling. Users see a shimmer card
 * instead of blank whitespace. Matches the aspect-square grid card style.
 *
 * Cost: ~4 DOM nodes, zero hooks, zero state, zero effects.
 */
export function SkeletonCard() {
  return (
    <div className="aspect-square rounded-xl border border-border bg-card flex flex-col items-center justify-center p-4 pointer-events-none">
      {/* Thumbnail placeholder */}
      <div className="flex-1 flex items-center justify-center w-full p-4 pb-0">
        <div className="w-10 h-10 rounded-lg bg-muted-foreground/8 animate-pulse" />
      </div>

      {/* Name placeholder */}
      <div className="w-full flex flex-col items-center gap-1.5 mt-2">
        <div className="h-3.5 rounded-sm bg-muted-foreground/8 animate-pulse w-[60%]" />
        <div className="h-2.5 rounded-sm bg-muted-foreground/5 animate-pulse w-[35%]" />
      </div>
    </div>
  );
}
