import Link from "next/link";
import { Clock, ArrowLeft } from "lucide-react";
import { OrgEmptyState } from "@/components/organizations/org-ui";

/**
 * Friendly placeholder for org sidebar destinations not yet built. Keeps
 * navigation 404-free while later phases fill these in. Server component.
 */
export function OrgComingSoon({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <OrgEmptyState
      icon={Clock}
      title={title}
      description={
        description ??
        "This area is coming soon as the organization workspace rolls out."
      }
      action={
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Home
        </Link>
      }
    />
  );
}
