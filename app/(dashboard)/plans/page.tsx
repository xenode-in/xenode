import { Suspense } from "react";
import PlansPageClient from "@/components/plans/PlansPageClient";

export const metadata = {
  title: "Plans",
  description: "Choose the Xenode plan that fits your needs.",
};

export default function PlansPage() {
  return (
    <Suspense>
      <PlansPageClient />
    </Suspense>
  );
}
