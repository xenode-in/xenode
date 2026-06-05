import { TableRow, TableCell } from "@/components/ui/table";

/**
 * SkeletonRow — ultra-lightweight list-view placeholder rendered during fast scrolls.
 *
 * When the virtualizer's `isScrolling` flag is true, this replaces the full
 * FileItem (which has context menus, hooks, decryption effects, etc.).
 * The goal: users see a shimmer row instead of blank whitespace.
 *
 * Cost: ~5 DOM nodes, zero hooks, zero state, zero effects.
 */
export function SkeletonRow() {
  return (
    <TableRow className="border-border hover:bg-transparent pointer-events-none h-[53px]">
      {/* Checkbox */}
      <TableCell className="w-10 pl-4 pr-0">
        <div className="w-4 h-4 rounded bg-muted-foreground/5 animate-pulse" />
      </TableCell>

      {/* Name */}
      <TableCell className="w-[45%] min-w-0">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded bg-muted-foreground/8 animate-pulse shrink-0" />
          <div className="h-3.5 rounded-sm bg-muted-foreground/8 animate-pulse w-[40%] min-w-[80px]" />
        </div>
      </TableCell>

      {/* Size */}
      <TableCell className="w-[15%]">
        <div className="h-3 rounded-sm bg-muted-foreground/5 animate-pulse w-[50px]" />
      </TableCell>

      {/* Type */}
      <TableCell className="w-[15%]">
        <div className="h-5 rounded-full bg-muted-foreground/5 animate-pulse w-[45px]" />
      </TableCell>

      {/* Date */}
      <TableCell className="w-[20%] hidden md:table-cell">
        <div className="h-3 rounded-sm bg-muted-foreground/5 animate-pulse w-[70px]" />
      </TableCell>

      {/* Actions */}
      <TableCell className="text-right w-[100px]" />
    </TableRow>
  );
}
