import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SheetsV2Page() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-8 text-center">
        <FileSpreadsheet className="mx-auto mb-4 h-10 w-10 text-emerald-500" />
        <h1 className="text-xl font-semibold">Office editor retained</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The legacy spreadsheet workspace has been removed. Isolated
          OnlyOffice editing remains available only through an explicit,
          security-approved file action.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard/files">Return to files</Link>
        </Button>
      </section>
    </main>
  );
}
