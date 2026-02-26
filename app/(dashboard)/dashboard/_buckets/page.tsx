"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function BucketsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/files");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}
