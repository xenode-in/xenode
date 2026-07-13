import { getServerSession } from "@/lib/auth/session";
import { InviteLandingClient } from "./InviteLandingClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Organization invitation | Xenode",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await getServerSession();

  return (
    <InviteLandingClient
      invitationId={invitationId}
      sessionEmail={session?.user?.email ?? null}
      isAuthenticated={!!session}
    />
  );
}
