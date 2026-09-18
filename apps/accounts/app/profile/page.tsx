import { AccountShell } from "@/components/AccountShell";
import { ProfileForm } from "@/components/ProfileForm";
import { loadProfile } from "@/lib/hub-data";
import { requireUnlockedAccountsPageSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await requireUnlockedAccountsPageSession("/profile");
  const profile = await loadProfile(session.user.id);
  return (
    <AccountShell user={session.user}>
      <main className="mx-auto w-full max-w-[1050px] px-5 py-10 md:px-8 md:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Profile
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">
          Make your account yours.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Choose how you appear across Xenode while keeping your verified
          identity and encryption preferences together.
        </p>
        <div className="mt-8">
          <ProfileForm initialProfile={profile} />
        </div>
      </main>
    </AccountShell>
  );
}
