"use client";
import { ArrowLeft, History, Redo2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SpreadsheetSaveState = "saved" | "dirty" | "saving" | "offline" | "failed" | "conflict" | "read_only";
const labels: Record<SpreadsheetSaveState, string> = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving", offline: "Offline draft", failed: "Save failed", conflict: "Conflict detected", read_only: "Read-only" };
export function SpreadsheetHeader(props: { name: string; workspace: string; state: SpreadsheetSaveState; onSave: () => void; onUndo: () => void; onRedo: () => void; onVersions: () => void; onBack: () => void }) {
  return <header className="flex min-h-14 items-center justify-between gap-3 border-b bg-background px-2 md:px-4">
    <div className="flex min-w-0 items-center gap-2"><Button variant="ghost" size="icon" onClick={props.onBack}><ArrowLeft className="h-4 w-4"/></Button><div className="min-w-0"><h1 className="truncate text-sm font-semibold">{props.name}</h1><p className="truncate text-[11px] text-muted-foreground">{props.workspace} · {labels[props.state]}</p></div></div>
    <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={props.onUndo} title="Undo"><Undo2 className="h-4 w-4"/></Button><Button variant="ghost" size="icon" onClick={props.onRedo} title="Redo"><Redo2 className="h-4 w-4"/></Button><Button variant="ghost" size="icon" onClick={props.onVersions} title="Version history"><History className="h-4 w-4"/></Button><Button size="sm" onClick={props.onSave} disabled={props.state === "saving" || props.state === "read_only" || props.state === "saved"}><Save className="mr-1.5 h-4 w-4"/>Save</Button></div>
  </header>;
}

