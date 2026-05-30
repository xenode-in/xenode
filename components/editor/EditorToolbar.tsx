"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Download,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Loader2,
  MoreHorizontal,
  Pilcrow,
  Redo2,
  Save,
  Strikethrough,
  Table as TableIcon,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DocFormat, OnlyOfficeAdapter } from "@/lib/onlyoffice/adapter";

/**
 * components/editor/EditorToolbar.tsx
 *
 * The document editor's chrome. Icon-only, Notion/Linear-flat (no gradients or
 * heavy shadows), every control a thin dispatch to {@link OnlyOfficeAdapter}.
 * It holds no document state: ONLYOFFICE doesn't report selection/active marks
 * back through the adapter boundary, so formatting buttons are momentary, not
 * toggles. Secondary controls collapse into an overflow menu below `lg`.
 *
 * Image insertion reads the file the user picks straight into an ArrayBuffer and
 * hands it to the adapter — those bytes are local and stay in the browser; the
 * iframe CSP forbids any egress.
 */

const FONT_FAMILIES = [
  "Arial",
  "Calibri",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 72];
const DEFAULT_FONT_SIZE = "11";

/** Ctrl on Windows/Linux, ⌘ on Apple — only affects tooltip copy. */
function useModKey(): string {
  // Lazy initializer (not an effect): the value is only ever read inside
  // lazily-mounted tooltip content, so computing it during render is safe and
  // avoids a set-state-in-effect.
  const [mod] = useState(() => {
    const platform =
      typeof navigator !== "undefined"
        ? navigator.platform || navigator.userAgent
        : "";
    return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
  });
  return mod;
}

function ToolButton({
  label,
  shortcut,
  icon: Icon,
  onClick,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded border border-background/20 bg-background/10 px-1 font-sans text-[10px] text-background/80">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function VSep() {
  return <Separator orientation="vertical" className="mx-0.5 h-5" />;
}

function ExportMenu({
  format,
  onExport,
}: {
  format: DocFormat;
  onExport: (f: DocFormat) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2"
          aria-label="Export"
        >
          <Download className="h-4 w-4" />
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onExport(format)}>
          <FileText className="h-4 w-4" />
          Export as .{format}
        </DropdownMenuItem>
        {format !== "pdf" && (
          <DropdownMenuItem onSelect={() => onExport("pdf")}>
            <FileText className="h-4 w-4" />
            Export as PDF
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditorToolbar({
  adapter,
  format,
  editable,
  saving,
  onSave,
  onExport,
}: {
  adapter: OnlyOfficeAdapter;
  format: DocFormat;
  editable: boolean;
  saving: boolean;
  onSave: () => void;
  onExport: (f: DocFormat) => void;
}) {
  const mod = useModKey();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [tableOpen, setTableOpen] = useState(false);

  // Read-only documents (PDF) get just a badge + export — no editing chrome.
  if (!editable) {
    return (
      <TooltipProvider delayDuration={300}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Read-only
          </span>
          <div className="ml-auto">
            <ExportMenu format={format} onExport={onExport} />
          </div>
        </div>
      </TooltipProvider>
    );
  }

  const handleImageFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const data = await file.arrayBuffer();
    adapter.insertImage({ data, mimeType: file.type || "image/png" });
  };

  const insertTable = () => {
    const rows = Math.min(Math.max(1, tableRows || 1), 20);
    const cols = Math.min(Math.max(1, tableCols || 1), 10);
    adapter.insertTable({ rows, cols });
    setTableOpen(false);
  };

  // Secondary controls: inline icons at lg+, an overflow menu below it.
  const collapsible: { label: string; icon: LucideIcon; run: () => void }[] = [
    {
      label: "Strikethrough",
      icon: Strikethrough,
      run: () => adapter.exec("strikethrough"),
    },
    { label: "Align left", icon: AlignLeft, run: () => adapter.exec("alignLeft") },
    {
      label: "Align center",
      icon: AlignCenter,
      run: () => adapter.exec("alignCenter"),
    },
    {
      label: "Align right",
      icon: AlignRight,
      run: () => adapter.exec("alignRight"),
    },
    {
      label: "Justify",
      icon: AlignJustify,
      run: () => adapter.exec("alignJustify"),
    },
    { label: "Bulleted list", icon: List, run: () => adapter.exec("bulletList") },
    {
      label: "Numbered list",
      icon: ListOrdered,
      run: () => adapter.exec("numberedList"),
    },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2">
        {/* History */}
        <ToolButton
          label="Undo"
          shortcut={`${mod}+Z`}
          icon={Undo2}
          onClick={() => adapter.exec("undo")}
        />
        <ToolButton
          label="Redo"
          shortcut={`${mod}+Shift+Z`}
          icon={Redo2}
          onClick={() => adapter.exec("redo")}
        />
        <VSep />

        {/* Text format */}
        <ToolButton
          label="Bold"
          shortcut={`${mod}+B`}
          icon={Bold}
          onClick={() => adapter.exec("bold")}
        />
        <ToolButton
          label="Italic"
          shortcut={`${mod}+I`}
          icon={Italic}
          onClick={() => adapter.exec("italic")}
        />
        <ToolButton
          label="Underline"
          shortcut={`${mod}+U`}
          icon={Underline}
          onClick={() => adapter.exec("underline")}
        />
        <VSep />

        {/* Paragraph style */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-2"
              aria-label="Paragraph style"
            >
              <Type className="h-4 w-4" />
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => adapter.setHeading(0)}>
              <Pilcrow className="h-4 w-4" />
              Normal text
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => adapter.setHeading(1)}>
              <Heading1 className="h-4 w-4" />
              Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => adapter.setHeading(2)}>
              <Heading2 className="h-4 w-4" />
              Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => adapter.setHeading(3)}>
              <Heading3 className="h-4 w-4" />
              Heading 3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Fonts */}
        <div className="hidden items-center gap-1 pl-0.5 md:flex">
          <VSep />
          <Select onValueChange={(v) => adapter.setFontFamily(v)}>
            <SelectTrigger size="sm" className="w-[124px] text-xs" aria-label="Font">
              <SelectValue placeholder="Font" />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map((f) => (
                <SelectItem key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            defaultValue={DEFAULT_FONT_SIZE}
            onValueChange={(v) => adapter.setFontSize(Number(v))}
          >
            <SelectTrigger
              size="sm"
              className="w-[60px] text-xs"
              aria-label="Font size"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Secondary controls — inline at lg+ */}
        <div className="hidden items-center gap-0.5 pl-0.5 lg:flex">
          <VSep />
          {collapsible.map(({ label, icon, run }) => (
            <ToolButton key={label} label={label} icon={icon} onClick={run} />
          ))}
          <VSep />
          <Popover open={tableOpen} onOpenChange={setTableOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Insert table"
                  >
                    <TableIcon className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Insert table</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-56">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Insert table</p>
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor="tbl-rows" className="text-xs">
                      Rows
                    </Label>
                    <Input
                      id="tbl-rows"
                      type="number"
                      min={1}
                      max={20}
                      value={tableRows}
                      onChange={(e) => setTableRows(Number(e.target.value))}
                      className="h-8"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor="tbl-cols" className="text-xs">
                      Columns
                    </Label>
                    <Input
                      id="tbl-cols"
                      type="number"
                      min={1}
                      max={10}
                      value={tableCols}
                      onChange={(e) => setTableCols(Number(e.target.value))}
                      className="h-8"
                    />
                  </div>
                </div>
                <Button size="sm" onClick={insertTable}>
                  Insert
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <ToolButton
            label="Insert image"
            icon={ImageIcon}
            onClick={() => fileInputRef.current?.click()}
          />
        </div>

        {/* Secondary controls — overflow menu below lg */}
        <div className="flex items-center pl-0.5 lg:hidden">
          <VSep />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More formatting"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {collapsible.map(({ label, icon: Icon, run }) => (
                <DropdownMenuItem key={label} onSelect={run}>
                  <Icon className="h-4 w-4" />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => adapter.insertTable({ rows: 3, cols: 3 })}
              >
                <TableIcon className="h-4 w-4" />
                Insert table
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                <ImageIcon className="h-4 w-4" />
                Insert image
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-0.5 pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onSave}
                disabled={saving}
                aria-label="Save"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2">
              <span>Save</span>
              <kbd className="rounded border border-background/20 bg-background/10 px-1 font-sans text-[10px] text-background/80">
                {mod}+S
              </kbd>
            </TooltipContent>
          </Tooltip>
          <ExportMenu format={format} onExport={onExport} />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageFile}
        />
      </div>
    </TooltipProvider>
  );
}
