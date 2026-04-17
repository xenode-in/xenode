"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import {
  Loader2,
  AlertCircle,
  Save,
  FileText,
  ArrowLeft,
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo,
  Redo,
  Type,
  Underline as UnderlineIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Underline } from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import FontFamily from "@tiptap/extension-font-family";
import { FontSize } from "@/lib/tiptap/fontSize";

interface DocxEditorProps {
  url: string; // Blob URL of the source docx
  name: string;
  onSave?: (blob: Blob) => Promise<void>;
  onBack?: () => void;
}

const MenuBar = ({ editor }: { editor: Editor | null }) => {
  if (!editor) return null;

  const buttons = [
    {
      type: "custom",
      component: (
        <select
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          value={editor.getAttributes("textStyle").fontFamily || ""}
          className="h-8 rounded border bg-background px-2 text-xs font-medium outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Font</option>
          <option value="Calibri">Calibri</option>
          <option value="Georgia">Georgia</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Inter">Inter</option>
          <option value="EB Garamond">Garamond</option>
        </select>
      ),
    },
    {
      type: "custom",
      component: (
        <select
          onChange={(e) => editor.chain().focus().setFontSize(`${Math.round(parseInt(e.target.value) * 1.333)}px`).run()}
          value={Math.round(parseInt(editor.getAttributes("textStyle").fontSize || "19px") / 1.333)}
          className="h-8 w-16 rounded border bg-background px-1 text-xs font-medium outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="8">8</option>
          <option value="9">9</option>
          <option value="10">10</option>
          <option value="11">11</option>
          <option value="12">12</option>
          <option value="14">14</option>
          <option value="16">16</option>
          <option value="18">18</option>
          <option value="20">20</option>
          <option value="24">24</option>
          <option value="28">28</option>
          <option value="36">36</option>
          <option value="48">48</option>
          <option value="72">72</option>
        </select>
      ),
    },
    { type: "divider" },
    {
      icon: <Undo className="h-4 w-4" />,
      title: "Undo",
      action: () => editor.chain().focus().undo().run(),
      disabled: !editor.can().chain().focus().undo().run(),
    },
    {
      icon: <Redo className="h-4 w-4" />,
      title: "Redo",
      action: () => editor.chain().focus().redo().run(),
      disabled: !editor.can().chain().focus().redo().run(),
    },
    { type: "divider" },
    {
      icon: <Heading1 className="h-4 w-4" />,
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: editor.isActive("heading", { level: 1 }),
    },
    {
      icon: <Heading2 className="h-4 w-4" />,
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: editor.isActive("heading", { level: 2 }),
    },
    {
      icon: <Heading3 className="h-4 w-4" />,
      title: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: editor.isActive("heading", { level: 3 }),
    },
    {
      icon: <Type className="h-4 w-4" />,
      title: "Paragraph",
      action: () => editor.chain().focus().setParagraph().run(),
      isActive: editor.isActive("paragraph"),
    },
    { type: "divider" },
    {
      icon: <Bold className="h-4 w-4" />,
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: editor.isActive("bold"),
    },
    {
      icon: <Italic className="h-4 w-4" />,
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: editor.isActive("italic"),
    },
    {
      icon: <UnderlineIcon className="h-4 w-4" />,
      title: "Underline",
      action: () => editor.chain().focus().toggleUnderline().run(),
      isActive: editor.isActive("underline"),
    },
    {
      icon: <Strikethrough className="h-4 w-4" />,
      title: "Strike",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: editor.isActive("strike"),
    },
    { type: "divider" },
    {
      icon: <AlignLeft className="h-4 w-4" />,
      title: "Align Left",
      action: () => editor.chain().focus().setTextAlign("left").run(),
      isActive: editor.isActive({ textAlign: "left" }),
    },
    {
      icon: <AlignCenter className="h-4 w-4" />,
      title: "Align Center",
      action: () => editor.chain().focus().setTextAlign("center").run(),
      isActive: editor.isActive({ textAlign: "center" }),
    },
    {
      icon: <AlignRight className="h-4 w-4" />,
      title: "Align Right",
      action: () => editor.chain().focus().setTextAlign("right").run(),
      isActive: editor.isActive({ textAlign: "right" }),
    },
    { type: "divider" },
    {
      icon: <List className="h-4 w-4" />,
      title: "Bullet List",
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: editor.isActive("bulletList"),
    },
    {
      icon: <ListOrdered className="h-4 w-4" />,
      title: "Ordered List",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: editor.isActive("orderedList"),
    },
    { type: "divider" },
    {
      type: "color",
      title: "Text Color",
      action: (color: string) => editor.chain().focus().setColor(color).run(),
      value: editor.getAttributes("textStyle").color || "#000000",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-background border-b sticky top-0 z-10 shadow-sm">
      {buttons.map((btn, i) => {
        if (btn.type === "divider") {
          return <div key={i} className="w-px h-6 bg-border mx-1" />;
        }
        if (btn.type === "custom") {
          return <div key={i}>{btn.component}</div>;
        }
        if (btn.type === "color") {
          return (
            <div key={i} className="flex items-center gap-1.5 ml-1">
              <input
                type="color"
                onInput={(e) =>
                  btn.action((e.target as HTMLInputElement).value)
                }
                value={btn.value}
                className="w-6 h-6 rounded cursor-pointer border-none bg-transparent"
                title={btn.title}
              />
            </div>
          );
        }
        return (
          <Button
            key={i}
            variant="ghost"
            size="icon"
            onClick={btn.action}
            disabled={btn.disabled}
            className={cn(
              "h-8 w-8 transition-colors",
              btn.isActive
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={btn.title}
          >
            {btn.icon}
          </Button>
        );
      })}
    </div>
  );
};

/**
 * DocxEditor provides a local-first Word document editing experience.
 */
export default function DocxEditor({
  url,
  name,
  onSave,
  onBack,
}: DocxEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docMetadata, setDocMetadata] = useState<any>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Color,
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        HTMLAttributes: {
          class: "max-w-full mx-auto my-8",
        },
      }),
      HorizontalRule.configure({
        HTMLAttributes: {
          class: "my-12",
        },
      }),
    ],
    content: "<p>Loading document...</p>",
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-[1056px] px-6 py-10 md:px-12 md:py-16",
        style: `font-family: var(--doc-font-family, 'Calibri'), 'Segoe UI', Arial, sans-serif; font-size: var(--doc-font-size, 15pt); background: white; color: #000; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);`,
      },
    },
  });

  // Effect to update editor font-family and size variables
  useEffect(() => {
    if (editor && docMetadata) {
      const root = document.documentElement;
      if (docMetadata.defaultFont) {
        root.style.setProperty("--doc-font-family", docMetadata.defaultFont);
      }
      if (docMetadata.defaultSizePx) {
        root.style.setProperty("--doc-font-size", docMetadata.defaultSizePx);
      }
    }
  }, [editor, docMetadata]);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      if (!url || !editor) return;

      try {
        setLoading(true);
        setError(null);

        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch document");
        const arrayBuffer = await response.arrayBuffer();

        if (cancelled) return;

        // Convert ArrayBuffer to Base64 for the server action
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = window.btoa(binary);

        // Call the new JSON-based parser action
        const { parseDocxToJSONAction } = await import("@/lib/actions/docx");
        const tiptapJson = await parseDocxToJSONAction(base64);

        if (!cancelled) {
          editor.commands.setContent(tiptapJson);
          setDocMetadata(tiptapJson.metadata);
          setLoading(false);
        }
      } catch (err) {
        console.error("[DocxEditor] Load error:", err);
        if (!cancelled) {
          setError("Failed to load document for high-fidelity editing.");
          setLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      cancelled = true;
    };
  }, [url, editor]);

  const handleSave = useCallback(async () => {
    if (!editor || !onSave) return;

    try {
      setSaving(true);
      // Use TipTap's native JSON as the source of truth
      // CRITICAL: We JSON stringify and parse to strip any Client-side Proxies or
      // Contextual objects that TipTap might include, which would break Next.js Server Actions.
      const rawJson = editor.getJSON();
      const sanitizedJson = JSON.parse(JSON.stringify(rawJson));

      // Use the server action to convert JSON to a real DOCX Buffer
      const { convertJSONToDocxAction } = await import("@/lib/actions/docx");
      const base64 = await convertJSONToDocxAction(sanitizedJson);

      // Convert base64 back to Blob
      const binaryString = window.atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const docxBlob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      await onSave(docxBlob);
      toast.success("Structure-preserved document saved");
    } catch (err) {
      console.error("[DocxEditor] Save error:", err);
      toast.error("Failed to save document structure");
    } finally {
      setSaving(false);
    }
  }, [editor, onSave, name]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-3" />
        <p className="text-lg font-medium text-foreground mb-2">{error}</p>
        <Button onClick={onBack} variant="outline" className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-muted/30 overflow-hidden">
      {/* Editor Toolbar/Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3 shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3 border-l pl-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 shadow-inner">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold truncate max-w-[200px] md:max-w-md text-foreground">
                {name}
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest leading-none">
                  Live Editing
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={loading || saving}
            variant="default"
            className="shadow-lg hover:shadow-primary/25 transition-all active:scale-95"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-muted/30 relative">
        <div className="max-w-[1000px] mx-auto min-h-full py-8 md:py-12 relative">
          <div className="bg-background shadow-2xl rounded-sm border min-h-[1100px] flex flex-col">
            <MenuBar editor={editor} />

            <div className="relative flex-1">
              {loading && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-[2px]">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-sm font-bold text-primary animate-pulse uppercase tracking-tighter">
                    Structuring Document...
                  </p>
                </div>
              )}
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>

      {/* Global styles for TipTap Typography */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Georgia&family=Inter:wght@400;500;600;700&family=EB+Garamond:ital,wght@0,400..800;1,400..800&display=swap');

        /* Word-accurate page styling */
        .ProseMirror {
          outline: none !important;
          font-family: var(--doc-font-family, 'Calibri'), 'Segoe UI', Arial, sans-serif;
          font-size: var(--doc-font-size, 15pt);
          line-height: 1.25;
          color: #000000;
        }

        /* Default paragraph - matches Word's Normal style - tighter */
        .ProseMirror p {
          margin: 0 0 6pt 0;
          color: inherit;
          font-size: inherit;
          line-height: 1.25;
        }

        /* Word heading styles - Bold but neutral */
        .ProseMirror h1 {
          font-size: 2.2em;
          font-weight: 800;
          color: #000;
          border-bottom: none;
          margin: 12pt 0 4pt 0;
          line-height: 1.1;
          font-family: 'Calibri Light', 'Calibri', sans-serif;
        }
        .ProseMirror h2 {
          font-size: 1.8em;
          font-weight: 700;
          color: #000;
          margin: 10pt 0 4pt 0;
          line-height: 1.1;
          font-family: 'Calibri Light', 'Calibri', sans-serif;
        }
        .ProseMirror h3 {
          font-size: 1.4em;
          font-weight: 700;
          color: #000;
          margin: 8pt 0 4pt 0;
          font-family: 'Calibri Light', 'Calibri', sans-serif;
        }
        .ProseMirror h4 {
          font-size: 1.1em;
          font-weight: 700;
          color: #000;
          margin: 6pt 0 4pt 0;
        }

        /* Lists - Word style */
        .ProseMirror ul {
          list-style-type: disc;
          padding-left: 24pt;
          margin: 0 0 8pt 0;
        }
        .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 24pt;
          margin: 0 0 8pt 0;
        }
        .ProseMirror li > p {
          margin: 0;
        }

        /* Tables - Word style */
        .ProseMirror table {
          border-collapse: collapse;
          width: 100%;
          margin: 8pt 0 16pt 0;
          font-size: 10pt;
        }
        .ProseMirror td,
        .ProseMirror th {
          border: 1px solid #a3a3a3;
          padding: 3pt 5.4pt;
          vertical-align: top;
          min-width: 40px;
          position: relative;
        }
        .ProseMirror th {
          background-color: #d6e4f0;
          font-weight: 700;
          text-align: left;
        }
        .ProseMirror .selectedCell::after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(59, 130, 246, 0.15);
          pointer-events: none;
          z-index: 2;
        }
        .ProseMirror .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
}
