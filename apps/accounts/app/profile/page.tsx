import { AccountShell } from "@/components/AccountShell";
import { ProfileForm } from "@/components/ProfileForm";
import { loadProfile } from "@/lib/hub-data";
import { requireAccountsPageSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await requireAccountsPageSession();
  const profile = await loadProfile(session.user.id);
  return (
    <AccountShell user={session.user}>
      <main className="page page-narrow">
        <p className="eyebrow">Identity</p>
        <h1>Profile</h1>
        <p className="lede">Your normalized username travels with you across Xenode products. Email changes require a separate verified flow.</p>
        <section className="card" style={{ marginTop: 32 }}>
          <ProfileForm initialProfile={profile} />
        </section>
      </main>
    </AccountShell>
  );
}
