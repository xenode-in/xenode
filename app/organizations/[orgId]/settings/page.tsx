import { redirect } from "next/navigation";

/** Legacy route — org settings now live in the unified dashboard shell. */
export default function LegacyOrgSettings() {
  redirect("/dashboard/org/settings");
}
