import { OrganizationsClient } from "@/components/organizations/OrganizationsClient";
import { requirePageSession } from "@/lib/auth/session";
import { enabledStorageRegions } from "@xenode/config/storage";

export default async function OrganizationsPage() {
  const session = await requirePageSession();

  return <OrganizationsClient user={session.user} storageRegions={enabledStorageRegions()} />;
}
