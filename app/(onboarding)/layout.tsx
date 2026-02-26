import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  // If they are already onboarded, don't let them back in
  if (session.user.onboarded) {
    redirect("/dashboard");
  }

  return <div className="min-h-screen bg-background">{children}</div>;
}
