"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Download,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { blockNoteToDocxBuffer } from "@/lib/editor/docxConverter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// BlockNote's built-in color palette (name → swatch shown in the picker).
const TEXT_COLORS: { name: string; swatch: string; label: string }[] = [
  { name: "default", swatch: "currentColor", label: "Default" },
  { name: "gray", swatch: "#9b9a97", label: "Gray" },
  { name: "brown", swatch: "#64473a", label: "Brown" },
  { name: "red", swatch: "#e03e3e", label: "Red" },
  { name: "orange", swatch: "#d9730d", label: "Orange" },
  { name: "yellow", swatch: "#dfab01", label: "Yellow" },
  { name: "green", swatch: "#448361", label: "Green" },
  { name: "blue", swatch: "#337ea9", label: "Blue" },
  { name: "purple", swatch: "#9065b0", label: "Purple" },
  { name: "pink", swatch: "#c14c8a", label: "Pink" },
];

const HIGHLIGHT_COLORS: { name: string; swatch: string; label: string }[] = [
  { name: "default", swatch: "transparent", label: "None" },
  { name: "gray", swatch: "#ebeced", label: "Gray" },
  { name: "brown", swatch: "#e9e5e3", label: "Brown" },
  { name: "red", swatch: "#fbe4e4", label: "Red" },
  { name: "orange", swatch: "#faebdd", label: "Orange" },
  { name: "yellow", swatch: "#fbf3db", label: "Yellow" },
  { name: "green", swatch: "#ddedea", label: "Green" },
  { name: "blue", swatch: "#ddebf1", label: "Blue" },
  { name: "purple", swatch: "#eae4f2", label: "Purple" },
  { name: "pink", swatch: "#f4dfeb", label: "Pink" },
];

// ── Editor state snapshot (drives active button highlighting) ───────────────
interface Snapshot {
  blockType: string;
  level: number | null;
  align: "left" | "center" | "right" | "justify";
  styles: Record<string, unknown>;
  canNest: boolean;
  canUnnest: boolean;
}

function safeBool(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

function useEditorSnapshot(editor: AnyEditor): Snapshot {
  const read = useCallback((): Snapshot => {
    try {
      const block = editor.getTextCursorPosition().block;
      const props = (block.props ?? {}) as {
        level?: number;
        textAlignment?: Snapshot["align"];
      };
      const styles = editor.getActiveStyles() as Record<string, unknown>;
      return {
        blockType: String(block.type),
        level: props.level ?? null,
        align: props.textAlignment ?? "left",
        styles: styles ?? {},
        canNest: safeBool(() => editor.canNestBlock()),
        canUnnest: safeBool(() => editor.canUnnestBlock()),
      };
    } catch {
      return {
        blockType: "paragraph",
        level: null,
        align: "left",
        styles: {},
        canNest: false,
        canUnnest: false,
      };
    }
  }, [editor]);

  const [snap, setSnap] = useState<Snapshot>(read);

  useEffect(() => {
    const update = () => setSnap(read());
    update();
    const unsubscribers = [editor.onChange(update), editor.onSelectionChange(update)];
    return () => {
      unsubscribers.forEach((u) => {
        if (typeof u === "function") u();
      });
    };
  }, [editor, read]);

  return snap;
}

// ── Small building blocks ───────────────────────────────────────────────────
function ToolButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's text selection when clicking (don't steal focus).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-sm transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function ColorPicker({
  editor,
  kind,
  current,
  icon,
  title,
  palette,
}: {
  editor: AnyEditor;
  kind: "textColor" | "backgroundColor";
  current: string;
  icon: ReactNode;
  title: string;
  palette: { name: string; swatch: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  const apply = (name: string) => {
    editor.addStyles({ [kind]: name });
    setOpen(false);
    editor.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className={cn(
            "inline-flex h-8 items-center justify-center gap-0.5 rounded-md px-1.5 text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground",
            current && current !== "default" && "text-foreground",
          )}
        >
          {icon}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1">
          {palette.map((c) => {
            const isActive = (current || "default") === c.name;
            return (
              <button
                key={c.name}
                type="button"
                title={c.label}
                aria-label={c.label}
                onClick={() => apply(c.name)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md border transition-transform hover:scale-105",
                  isActive ? "ring-2 ring-primary ring-offset-1" : "border-border",
                )}
              >
                {kind === "textColor" ? (
                  <span
                    className="text-sm font-semibold leading-none"
                    style={{ color: c.swatch === "currentColor" ? undefined : c.swatch }}
                  >
                    A
                  </span>
                ) : (
                  <span
                    className="h-4 w-4 rounded-sm border border-black/10"
                    style={{
                      backgroundColor:
                        c.swatch === "transparent" ? undefined : c.swatch,
                      backgroundImage:
                        c.swatch === "transparent"
                          ? "linear-gradient(45deg, var(--border) 25%, transparent 25%, transparent 75%, var(--border) 75%)"
                          : undefined,
                      backgroundSize: c.swatch === "transparent" ? "6px 6px" : undefined,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinkButton({ editor }: { editor: AnyEditor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const apply = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const href = /^(https?:|mailto:|tel:)/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const selected = editor.getSelectedText();
    editor.createLink(href, selected ? undefined : trimmed);
    setUrl("");
    setOpen(false);
    editor.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Insert link"
          aria-label="Insert link"
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Link2 className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste or type a link…"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!url.trim()}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

const BLOCK_TYPE_OPTIONS = [
  { label: "Normal text", type: "paragraph" as const, level: null },
  { label: "Heading 1", type: "heading" as const, level: 1 },
  { label: "Heading 2", type: "heading" as const, level: 2 },
  { label: "Heading 3", type: "heading" as const, level: 3 },
];

function currentBlockLabel(snap: Snapshot): string {
  if (snap.blockType === "heading" && snap.level) return `Heading ${snap.level}`;
  return "Normal text";
}

// ── The persistent toolbar ──────────────────────────────────────────────────
export function EditorToolbar({
  editor,
  fileName,
  statusSlot,
}: {
  editor: AnyEditor;
  fileName: string;
  statusSlot?: ReactNode;
}) {
  const snap = useEditorSnapshot(editor);
  const [exporting, setExporting] = useState(false);

  const currentBlock = () => editor.getTextCursorPosition().block;

  const setBlockType = (type: string, level: number | null) => {
    const block = currentBlock();
    editor.updateBlock(block, level ? { type, props: { level } } : { type });
    editor.focus();
  };

  const toggleList = (type: string) => {
    const block = currentBlock();
    editor.updateBlock(block, { type: block?.type === type ? "paragraph" : type });
    editor.focus();
  };

  const setAlign = (textAlignment: Snapshot["align"]) => {
    editor.updateBlock(currentBlock(), { props: { textAlignment } });
    editor.focus();
  };

  const toggle = (style: string) => editor.toggleStyles({ [style]: true });

  const handleExport = async () => {
    if (exporting) return;
    try {
      setExporting(true);
      const buffer = await blockNoteToDocxBuffer(editor);
      const url = URL.createObjectURL(new Blob([buffer], { type: DOCX_MIME }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = /\.docx$/i.test(fileName)
        ? fileName
        : `${fileName.replace(/\.[^./\\]+$/, "") || "document"}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      toast.error("Couldn't export the document. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const styles = snap.styles;

  return (
    <div className="sticky top-0 z-20 flex items-center gap-1 border-b bg-card/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      {/* Scrollable formatting groups */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:thin]">
        <ToolButton title="Undo (Ctrl+Z)" onClick={() => editor.undo()}>
          <Undo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Redo (Ctrl+Y)" onClick={() => editor.redo()}>
          <Redo2 className="h-4 w-4" />
        </ToolButton>

        <ToolDivider />

        {/* Block type / paragraph style */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-[120px] justify-between px-2 font-normal text-foreground"
            >
              <span className="truncate">{currentBlockLabel(snap)}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {BLOCK_TYPE_OPTIONS.map((opt) => {
              const isActive =
                snap.blockType === opt.type &&
                (opt.level === null || snap.level === opt.level);
              return (
                <DropdownMenuItem
                  key={opt.label}
                  onClick={() => setBlockType(opt.type, opt.level)}
                  className={cn(isActive && "bg-accent text-accent-foreground")}
                >
                  <span
                    className={cn(
                      opt.type === "heading" && opt.level === 1 && "text-lg font-bold",
                      opt.type === "heading" && opt.level === 2 && "text-base font-semibold",
                      opt.type === "heading" && opt.level === 3 && "text-sm font-semibold",
                    )}
                  >
                    {opt.label}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolDivider />

        {/* Inline styles */}
        <ToolButton title="Bold (Ctrl+B)" active={!!styles.bold} onClick={() => toggle("bold")}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Italic (Ctrl+I)" active={!!styles.italic} onClick={() => toggle("italic")}>
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Underline (Ctrl+U)"
          active={!!styles.underline}
          onClick={() => toggle("underline")}
        >
          <Underline className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Strikethrough" active={!!styles.strike} onClick={() => toggle("strike")}>
          <Strikethrough className="h-4 w-4" />
        </ToolButton>

        <ColorPicker
          editor={editor}
          kind="textColor"
          current={(styles.textColor as string) ?? "default"}
          icon={<Baseline className="h-4 w-4" />}
          title="Text color"
          palette={TEXT_COLORS}
        />
        <ColorPicker
          editor={editor}
          kind="backgroundColor"
          current={(styles.backgroundColor as string) ?? "default"}
          icon={<Highlighter className="h-4 w-4" />}
          title="Highlight color"
          palette={HIGHLIGHT_COLORS}
        />
        <LinkButton editor={editor} />

        <ToolDivider />

        {/* Alignment */}
        <ToolButton title="Align left" active={snap.align === "left"} onClick={() => setAlign("left")}>
          <AlignLeft className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Align center"
          active={snap.align === "center"}
          onClick={() => setAlign("center")}
        >
          <AlignCenter className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Align right" active={snap.align === "right"} onClick={() => setAlign("right")}>
          <AlignRight className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Justify"
          active={snap.align === "justify"}
          onClick={() => setAlign("justify")}
        >
          <AlignJustify className="h-4 w-4" />
        </ToolButton>

        <ToolDivider />

        {/* Lists */}
        <ToolButton
          title="Bulleted list"
          active={snap.blockType === "bulletListItem"}
          onClick={() => toggleList("bulletListItem")}
        >
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Numbered list"
          active={snap.blockType === "numberedListItem"}
          onClick={() => toggleList("numberedListItem")}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Check list"
          active={snap.blockType === "checkListItem"}
          onClick={() => toggleList("checkListItem")}
        >
          <ListChecks className="h-4 w-4" />
        </ToolButton>

        <ToolDivider />

        {/* Indent */}
        <ToolButton
          title="Decrease indent"
          disabled={!snap.canUnnest}
          onClick={() => editor.unnestBlock()}
        >
          <IndentDecrease className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Increase indent"
          disabled={!snap.canNest}
          onClick={() => editor.nestBlock()}
        >
          <IndentIncrease className="h-4 w-4" />
        </ToolButton>
      </div>

      {/* Right cluster: save status + export (always visible) */}
      <div className="flex shrink-0 items-center gap-2 pl-2">
        {statusSlot}
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>
    </div>
  );
}
