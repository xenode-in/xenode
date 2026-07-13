"use client";
import { AlertTriangle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { CompatibilityReport } from "@/lib/spreadsheets/types";
export function SpreadsheetCompatibilityDialog({ open, report, onContinue, onCancel }: { open: boolean; report: CompatibilityReport; onContinue: () => void; onCancel: () => void }) {
  return <AlertDialog open={open}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500"/>Compatibility warning</AlertDialogTitle><AlertDialogDescription>Some Excel features may not survive this browser-only round trip. The original encrypted version remains in version history.</AlertDialogDescription></AlertDialogHeader><ul className="max-h-52 space-y-2 overflow-auto text-sm">{report.issues.map((issue) => <li key={`${issue.feature}:${issue.sheetId ?? ""}`} className="rounded-md border p-2"><span className="font-medium">{issue.feature.replaceAll("_", " ")}</span><span className="ml-2 text-xs text-muted-foreground">{issue.support.replaceAll("_", " ")}</span><p className="text-xs text-muted-foreground">{issue.message}</p></li>)}</ul><AlertDialogFooter><AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel><AlertDialogAction onClick={onContinue}>Continue saving</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

