"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, RotateCcw } from "lucide-react";

interface Props {
  paymentId: string;
  amount: number;
}

export default function RefundButton({ paymentId, amount }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleRefund = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/payment/razorpay/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, amount }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate refund");
      }

      toast.success("Refund initiated successfully!");
      router.refresh(); // Refresh billing page to show updated status
    } catch (error: any) {
      console.error("Refund error:", error);
      toast.error(error.message || "An error occurred while requesting refund.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors ml-3"
        disabled={loading}
      >
        <RotateCcw className="h-3 w-3" />
        Request Refund
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Request Refund?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to refund this payment of ₹{amount.toFixed(2)}?
            <br /><br />
            <strong>Important:</strong> Your account will be immediately downgraded to the Free tier (5 GB storage). If you are currently over this limit, you won&apos;t be able to upload new files until you delete enough data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleRefund();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Confirm Refund"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
