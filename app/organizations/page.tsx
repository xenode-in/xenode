import { redirect } from "next/navigation";
import { OrganizationsClient } from "@/components/organizations/OrganizationsClient";
import { getServerSession } from "@/lib/auth/session";

export default async function OrganizationsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return <OrganizationsClient user={session.user} />;
}
