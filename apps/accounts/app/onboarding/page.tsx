import { redirect } from "next/navigation";
import { AccountProfile, connectDatabase } from "@xenode/database";
import { requireAccountsPageSession } from "@/lib/session";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata = { title: "Welcome" };

function safeNext(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireAccountsPageSession();
  const next = safeNext((await searchParams).next);
  if (session.user.emailVerified === false) {
    redirect(`/verify-email?next=${encodeURIComponent(`/onboarding?next=${next}`)}`);
  }
  await connectDatabase();
  const profile = await AccountProfile.findOne({
    accountId: session.user.id,
  }).lean();
  if (profile?.onboarded) redirect(next);

  return (
    <OnboardingWizard
      accountId={session.user.id}
      email={session.user.email ?? ""}
      name={session.user.name ?? ""}
      next={next}
    />
  );
}
