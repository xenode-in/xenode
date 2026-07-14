"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORIES = [
  { value: "billing", label: "Billing question" },
  { value: "technical", label: "Technical issue" },
  { value: "account", label: "Account help" },
  { value: "general", label: "General question" },
];

export default function NewSupportTicketPage() {
  const router = useRouter();
  const [category, setCategory] = useState("billing");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (subject.trim().length < 3) {
      setError("Subject must be at least 3 characters.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Please describe your issue in at least 10 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description, category }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create ticket");
      }
      router.push(`/dashboard/support/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard/support"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to support
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">New ticket</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tell us what&apos;s going on and we&apos;ll get back to you within 1-2 business days.
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          Looking to request a refund? Open it{" "}
          <Link href="/dashboard/billing" className="text-primary underline">
            from your billing page
          </Link>{" "}
          so we can verify your eligibility.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="One-line summary of your issue"
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Describe your issue</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What were you trying to do? What happened instead? Include any error messages."
            rows={8}
            maxLength={8000}
          />
          <p className="text-xs text-muted-foreground">
            {description.length}/8000 characters
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <Link href="/dashboard/support">Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Submit ticket
          </Button>
        </div>
      </form>
    </div>
  );
}
