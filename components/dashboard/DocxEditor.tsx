"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import mammoth from "mammoth";
import { Loader2, AlertCircle, Save, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface DocxEditorProps {
  url: string; // Blob URL of the source docx
  name: string;
  onSave?: (blob: Blob) => Promise<void>;
  onBack?: () => void;
}

/**
 * DocxEditor provides a local-first Word document editing experience.
 * It uses Mammoth.js to convert DOCX to HTML for TipTap, and
 * is intended to use html-to-docx (dynamically imported) for saving.
 */
export default function DocxEditor({ url, name, onSave, onBack }: DocxEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
    ],
    content: "<p>Loading document...</p>",
    editorProps: {
      attributes: {
        class: "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[700px] p-8 bg-white shadow-lg border rounded-md",
        style: "color: black !important; font-family: 'Inter', sans-serif;"
      },
    },
  });

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

        // Convert DOCX to HTML using Mammoth
        const result = await mammoth.convertToHtml({ arrayBuffer });
        
        if (!cancelled) {
          editor.commands.setContent(result.value);
          setLoading(false);
          if (result.messages.length > 0) {
            console.warn("[DocxEditor] Mammoth warnings:", result.messages);
          }
        }
      } catch (err) {
        console.error("[DocxEditor] Load error:", err);
        if (!cancelled) {
          setError("Failed to load document for editing.");
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
      const html = editor.getHTML();

      // Wrap HTML in a basic doc structure for html-docx-js
      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
          </head>
          <body>
            ${html}
          </body>
        </html>
      `;

      // Dynamically import to avoid any SSR issues
      const { asBlob } = await import("html-docx-js-typescript");
      
      const docxBlob = await asBlob(fullHtml, {
        orientation: "portrait",
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      });

      await onSave(docxBlob as Blob);
      toast.success("Document saved successfully");
    } catch (err) {
      console.error("[DocxEditor] Save error:", err);
      toast.error("Failed to save document");
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
    <div className="flex h-full flex-col bg-muted/20 overflow-hidden">
      {/* Editor Toolbar/Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-500/10 text-blue-600">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold truncate max-w-[200px] md:max-w-md">
                {name}
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none">
                Editing Mode
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            onClick={handleSave} 
            disabled={loading || saving}
            variant="default"
            className="shadow-sm transition-all hover:shadow-md"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-4 md:p-8 relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-sm font-medium text-muted-foreground">Preparing editor...</p>
          </div>
        )}
        
        <div className="max-w-[900px] mx-auto min-h-full pb-32">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Global styles for TipTap and Black Text */}
      <style jsx global>{`
        .ProseMirror {
          color: black !important;
        }
        .ProseMirror p {
          color: black !important;
          margin-bottom: 1em;
        }
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
          color: black !important;
          font-weight: 700;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        /* Custom scrollbar for a more premium feel */
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.1);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.2);
        }
      `}</style>
    </div>
  );
}
