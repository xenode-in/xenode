import { redirect } from "next/navigation";
import { sanitizeReturnTo } from "@xenode/identity-core";
import { getAccountOnboardingReadiness } from "@xenode/database";
import { requireAccountsPageSession } from "@/lib/session";
import { OnboardingWizard } from "./OnboardingWizard";
import { enabledStorageRegions } from "@xenode/config/storage";

export const metadata = { title: "Welcome" };

function safeNext(value: string | undefined): string {
  return sanitizeReturnTo(value, "/");
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireAccountsPageSession();
  const next = safeNext((await searchParams).next);
  if (session.user.emailVerified === false) {
    redirect(
      `/verify-email?email=${encodeURIComponent(session.user.email)}&next=${encodeURIComponent(`/onboarding?next=${encodeURIComponent(next)}`)}`,
    );
  }
  const readiness = await getAccountOnboardingReadiness(session.user.id);
  if (readiness.complete) redirect(next);
  if (readiness.profileOnboarded && readiness.hasVault) {
    redirect(`/auth/continue?next=${encodeURIComponent(next)}`);
  }

  return (
    <OnboardingWizard
      accountId={session.user.id}
      storageRegions={enabledStorageRegions()}
      hasExistingVault={readiness.hasVault}
      email={session.user.email ?? ""}
      name={session.user.name ?? ""}
      username={
        "username" in session.user && typeof session.user.username === "string"
          ? session.user.username
          : ""
      }
      next={next}
    />
  );
}
