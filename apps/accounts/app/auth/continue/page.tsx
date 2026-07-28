import { redirect } from "next/navigation";
import { AccountProfile, UserVault, connectDatabase } from "@xenode/database";
import { requireAccountsPageSession } from "@/lib/session";

function safeNext(value: string | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function AuthContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireAccountsPageSession();
  const next = safeNext((await searchParams).next);
  if (session.user.emailVerified === false) {
    redirect(
      `/verify-email?email=${encodeURIComponent(session.user.email)}&next=${encodeURIComponent(`/auth/continue?next=${encodeURIComponent(next)}`)}`,
    );
  }
  await connectDatabase();
  const [profile, vault] = await Promise.all([
    AccountProfile.findOne({ accountId: session.user.id }).lean(),
    UserVault.findOne({ accountId: session.user.id }).select("_id").lean(),
  ]);
  if (!profile?.onboarded || !vault) {
    redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}
