import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { SheetsV2DemoEditor } from "@/components/sheets-v2/SheetsV2DemoEditor";
import { ONLYOFFICE_ARTIFACT_VERSION } from "@/lib/spreadsheets/v2/config";

export default function SheetsV2Page() {
  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-emerald-600 p-1.5 text-white">
            <FileSpreadsheet className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Xenode Sheets v2</span>
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                ONLYOFFICE {ONLYOFFICE_ARTIFACT_VERSION}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Server-less editor · demo workbook · v1 remains the default
            </span>
          </div>
        </div>
        <Link
          href="/sheets"
          className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          <ArrowLeft className="size-3.5" />
          Current editor
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <SheetsV2DemoEditor />
      </div>
    </main>
  );
}
