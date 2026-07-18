import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { OnboardingForm } from "@/app/(onboarding)/onboarding/OnboardingForm";

export const metadata = {
  title: "Onboarding | Xenode",
  description: "Set up your Xenode preferences",
};

export default async function OnboardingPage() {
  const session = await getServerSession();

  if (!session) {
    redirect("/auth/login");
  }

  // Email verification is enforced by the Accounts authority at sign-in.

  // If already onboarded, send them to dashboard
  if (session.user.onboarded) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <OnboardingForm />
      </div>
    </div>
  );
}
