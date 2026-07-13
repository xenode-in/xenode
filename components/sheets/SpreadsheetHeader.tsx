"use client";
import { ArrowLeft, Download, History, MessageSquare, Redo2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpreadsheetExportFormat } from "@/lib/spreadsheets/types";

export type SpreadsheetSaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "offline"
  | "failed"
  | "conflict"
  | "read_only";

const labels: Record<SpreadsheetSaveState, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving",
  offline: "Offline draft",
  failed: "Save failed",
  conflict: "Conflict detected",
  read_only: "Read-only",
};

const exportOptions: Array<{
  format: SpreadsheetExportFormat;
  label: string;
}> = [
  { format: "xlsx", label: "Excel workbook (.xlsx)" },
  { format: "xls", label: "Excel 97–2004 (.xls)" },
  { format: "csv", label: "Comma-separated values (.csv)" },
  { format: "tsv", label: "Tab-separated values (.tsv)" },
  { format: "ods", label: "OpenDocument spreadsheet (.ods)" },
];

export function SpreadsheetHeader(props: {
  name: string;
  workspace: string;
  state: SpreadsheetSaveState;
  onSave: () => void;
  onExport: (format: SpreadsheetExportFormat) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onVersions?: () => void;
  onComments?: () => void;
  onBack: () => void;
  /** Extra header content, e.g. a View-only badge + request-access button for shares. */
  accessSlot?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 border-b bg-background px-2 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" onClick={props.onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{props.name}</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {props.workspace} · {labels[props.state]} · Original protected
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {props.accessSlot}
        {props.onUndo && (
          <Button variant="ghost" size="icon" onClick={props.onUndo} title="Undo">
            <Undo2 className="h-4 w-4" />
          </Button>
        )}
        {props.onRedo && (
          <Button variant="ghost" size="icon" onClick={props.onRedo} title="Redo">
            <Redo2 className="h-4 w-4" />
          </Button>
        )}
        {props.onComments && (
          <Button variant="ghost" size="icon" onClick={props.onComments} title="Comments">
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}
        {props.onVersions && (
          <Button variant="ghost" size="icon" onClick={props.onVersions} title="Version history">
            <History className="h-4 w-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {exportOptions.map((option) => (
              <DropdownMenuItem
                key={option.format}
                onSelect={() => props.onExport(option.format)}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          onClick={props.onSave}
          disabled={
            props.state === "saving" ||
            props.state === "read_only" ||
            props.state === "saved"
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          Save
        </Button>
      </div>
    </header>
  );
}