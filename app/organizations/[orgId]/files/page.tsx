import { redirect } from "next/navigation";

/** Legacy route — org files now live in the unified dashboard shell. */
export default function LegacyOrgFiles() {
  redirect("/dashboard/org/files");
}
