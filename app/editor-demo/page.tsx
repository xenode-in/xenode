"use client";

// DEV-ONLY demo route to preview the document editor's look & feel without a
// vault or a stored file. Generates a sample .docx in the browser, encrypts it
// in memory, and mounts the real <DocumentEditor/>. Safe to delete anytime.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { Loader2 } from "lucide-react";
import { encryptDocument } from "@/lib/crypto/documentCrypto";

const DocumentEditor = dynamic(
  () => import("@/components/editor/DocumentEditor"),
  { ssr: false },
);

async function buildSampleDocx(): Promise<ArrayBuffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Project Proposal")],
          }),
          new Paragraph({
            children: [
              new TextRun("This document is rendered inside the editor with "),
              new TextRun({ text: "bold", bold: true }),
              new TextRun(", "),
              new TextRun({ text: "italic", italics: true }),
              new TextRun(", and "),
              new TextRun({ text: "underlined", underline: {} }),
              new TextRun(
                " text — exactly as it will look. Everything happens locally; only encrypted bytes ever leave the page.",
              ),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Goals")],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun("Privacy-first, end-to-end encrypted storage.")],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun("A surface that reads like a real document.")],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun("Fast, distraction-free editing.")],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun("Next steps")],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "Try the toolbar above: change the paragraph style, toggle formatting, add a list, then press Ctrl/Cmd+S or use Export.",
              ),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return blob.arrayBuffer();
}

export default function EditorDemoPage() {
  const [data, setData] = useState<{
    encryptedBlob: ArrayBuffer;
    cryptoKey: CryptoKey;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const docxBuffer = await buildSampleDocx();
      const cryptoKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      const encryptedBlob = await encryptDocument(docxBuffer, cryptoKey);
      if (!cancelled) setData({ encryptedBlob, cryptoKey });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (process.env.NODE_ENV === "production") {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Demo unavailable in production.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen">
      <DocumentEditor
        encryptedBlob={data.encryptedBlob}
        cryptoKey={data.cryptoKey}
        fileName="Demo.docx"
        onSave={async () => {
          /* demo: no persistence */
        }}
      />
    </div>
  );
}
