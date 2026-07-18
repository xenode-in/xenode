import { redirect } from "next/navigation";

/**
 * Legacy per-org route. The in-org workspace now lives under `/dashboard/org/*`
 * driven by the active-workspace switcher; this page redirects there.
 */
export default function LegacyOrgHome() {
  redirect("/dashboard");
}
