import { Loader2, ShieldCheck } from "lucide-react";
export function SpreadsheetLoadingState({ label = "Decrypting workbook locally" }: { label?: string }) {
  return <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-3"><Loader2 className="h-9 w-9 animate-spin text-emerald-500"/><p className="text-sm font-medium">{label}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5"/>Workbook contents never leave this browser</p></div>;
}

