import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import mongoose from "mongoose";
import { getPlanBySlug } from "@/lib/config/plans";
import CheckoutPage from "@/components/checkout/CheckoutPage";

export const metadata = {
  title: "Checkout — Xenode",
  robots: "noindex",
};

interface CheckoutPageProps {
  searchParams: Promise<{ plan?: string }>;
}

export default async function Page({ searchParams }: CheckoutPageProps) {
  const params = await searchParams;
  const planSlug = params.plan;

  // Guard: must have a valid plan slug
  const plan = planSlug ? getPlanBySlug(planSlug) : undefined;
  if (!plan) redirect("/pricing");

  // Guard: must be authenticated
  const session = await getServerSession();
  if (!session?.user) redirect(`/sign-in?next=/checkout?plan=${planSlug}`);

  await dbConnect();

  const db = mongoose.connection.db;
  if (!db) redirect("/pricing");

  // Fetch user profile for pre-fill
  const userDoc = await db
    .collection("user")
    .findOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) },
      { projection: { phone: 1, billingAddress: 1 } },
    );

  // Calculate proration credit
  const currentUsage = await Usage.findOne({ userId: session.user.id }).lean();
  let prorationCredit = 0;
  if (
    currentUsage &&
    currentUsage.plan !== "free" &&
    currentUsage.planExpiresAt &&
    new Date(currentUsage.planExpiresAt).getTime() > Date.now() &&
    currentUsage.planPriceINR > 0
  ) {
    const msRemaining = new Date(currentUsage.planExpiresAt).getTime() - Date.now();
    const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
    prorationCredit = Math.round((currentUsage.planPriceINR / 30) * daysRemaining * 100) / 100;
  }

  const finalAmount = Math.max(1, plan.priceINR - prorationCredit);

  return (
    <CheckoutPage
      plan={plan}
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        phone: userDoc?.phone || "",
        billingAddress: userDoc?.billingAddress || null,
      }}
      prorationCredit={prorationCredit}
      finalAmount={parseFloat(finalAmount.toFixed(2))}
    />
  );
}
