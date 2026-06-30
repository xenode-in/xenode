import Link from "next/link";
import { Clock, ArrowLeft } from "lucide-react";

/**
 * Friendly placeholder for org sidebar destinations not yet built (Activity,
 * People, Requests, Teams, etc.). Keeps navigation 404-free while later phases
 * fill these in. Server component — purely presentational.
 */
export function OrgComingSoon({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary/40">
        <Clock className="h-6 w-6 text-muted-foreground/50" />
      </div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description ?? "This area is coming soon as the organization workspace rolls out."}
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Home
      </Link>
    </div>
  );
}
