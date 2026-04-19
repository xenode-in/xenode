"use server";

import { JSONContent } from "@tiptap/react";
import officeParser from "officeparser";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  IParagraphOptions,
} from "docx";
import { officeASTToTiptapJSON } from "@/lib/office/normalizer";

/**
 * parseDocxToJSONAction
 * Uses officeparser and our normalizer to turn a DOCX blob into TipTap JSON.
 */
export async function parseDocxToJSONAction(
  base64: string,
): Promise<JSONContent> {
  try {
    const buffer = Buffer.from(base64, "base64");

    // officeparser expects a path or a buffer
    const ast = await officeParser.parseOffice(buffer);

    // Convert AST to TipTap JSON (ast might need a cast if officeparser returns any)
    return officeASTToTiptapJSON(ast as any);
  } catch (error) {
    console.error("[parseDocxToJSONAction] Error:", error);
    throw new Error("Failed to parse document to JSON");
  }
}

/**
 * convertJSONToDocxAction
 * Uses the 'docx' library to build a high-fidelity Word document from TipTap JSON.
 */
export async function convertJSONToDocxAction(
  json: JSONContent,
): Promise<string> {
  try {
    const doc = new Document({
      numbering: {
        config: [
          {
            reference: "bullet-numbering",
            levels: [
              {
                level: 0,
                format: "bullet",
                alignment: AlignmentType.LEFT,
                text: "•",
              },
            ],
          },
          {
            reference: "ordered-numbering",
            levels: [
              {
                level: 0,
                format: "decimal",
                alignment: AlignmentType.LEFT,
                text: "%1.",
              },
            ],
          },
        ],
      },
      sections: [
        {
          children: mapJSONToDocxNodes(json.content || []),
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    return Buffer.from(buffer).toString("base64");
  } catch (error) {
    console.error("[convertJSONToDocxAction] Error:", error);
    throw new Error("Failed to generate DOCX from JSON");
  }
}

function mapJSONToDocxNodes(
  nodes: JSONContent[],
  options: Partial<IParagraphOptions> = {},
): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        result.push(
          new Paragraph({
            text: extractText(node),
            heading: getHeadingLevel(node.attrs?.level),
            ...options,
          }),
        );
        break;

      case "paragraph":
        result.push(
          new Paragraph({
            children: mapTextMarks(node.content || []),
            alignment: getAlignment(node.attrs?.textAlign),
            ...options,
          }),
        );
        break;

      case "horizontalRule":
        result.push(
          new Paragraph({
            thematicBreak: true,
          }),
        );
        break;

      case "bulletList":
      case "orderedList": {
        const isOrdered = node.type === "orderedList";
        const numbering = {
          reference: isOrdered ? "ordered-numbering" : "bullet-numbering",
          level: 0,
        };

        (node.content || []).forEach((listItem) => {
          // listItem content is usually a paragraph. Pass numbering options down.
          const itemContent = mapJSONToDocxNodes(listItem.content || [], {
            numbering,
          });
          // result.push(...itemContent) might include tables if nested, but usually paragraphs
          result.push(...(itemContent as (Paragraph | Table)[]));
        });
        break;
      }

      case "table": {
        // Calculate column widths if available in TipTap JSON
        let columnWidths: number[] | undefined = undefined;
        const firstRow = node.content?.[0];
        if (firstRow && firstRow.content) {
          columnWidths = firstRow.content.map((cell) => {
            const widths = cell.attrs?.colwidth;
            if (Array.isArray(widths) && widths[0]) {
              // Convert px to twips (1px approx 15 twips)
              return Math.round(widths[0] * 15);
            }
            return 2000; // Default wide width
          });
        }

        result.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths,
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
              insideHorizontal: {
                style: BorderStyle.SINGLE,
                size: 2,
                color: "666666",
              },
              insideVertical: {
                style: BorderStyle.SINGLE,
                size: 2,
                color: "666666",
              },
            },
            rows: (node.content || []).map(
              (row) =>
                new TableRow({
                  children: (row.content || []).map(
                    (cell) =>
                      new TableCell({
                        children: mapJSONToDocxNodes(
                          cell.content || [],
                        ) as Paragraph[],
                        verticalAlign: VerticalAlign.CENTER,
                        margins: {
                          top: 100, // 5pt approx
                          bottom: 100,
                          left: 150, // 7.5pt approx
                          right: 150,
                        },
                      }),
                  ),
                }),
            ),
          }),
        );
        break;
      }

      case "image":
        result.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[Image: ${node.attrs?.alt || "Imported Image"}]`,
                color: "999999",
                italics: true,
              }),
            ],
          }),
        );
        break;

      default:
        // Try to handle text nodes if they appear at top level (unlikely but safe)
        if (node.type === "text") {
          result.push(
            new Paragraph({
              children: mapTextMarks([node]),
              ...options,
            }),
          );
        }
    }
  }

  return result.filter(Boolean);
}

function mapTextMarks(content: JSONContent[]): TextRun[] {
  return content
    .map((item) => {
      if (item.type === "text") {
        const marks = item.marks || [];
        const textStyle =
          marks.find((m) => m.type === "textStyle")?.attrs || {};

        const options: any = {
          text: item.text || "",
          bold: !!marks.find((m) => m.type === "bold"),
          italics: !!marks.find((m) => m.type === "italic"),
          underline: !!marks.find((m) => m.type === "underline")
            ? {}
            : undefined,
          strike: !!marks.find((m) => m.type === "strike"),
        };

        // Export Font Family
        if (textStyle.fontFamily) {
          options.font = textStyle.fontFamily;
        }

        // Export Font Size (px to half-points)
        // Formula: (px / 1.333) = pt. pt * 2 = half-points.
        if (textStyle.fontSize) {
          const pt = parseInt(textStyle.fontSize) / 1.333;
          options.size = Math.round(pt * 2);
        }

        // Export Color (strip #)
        if (textStyle.color) {
          options.color = textStyle.color.replace("#", "");
        }

        return new TextRun(options);
      }
      return null;
    })
    .filter((v): v is TextRun => !!v);
}

function extractText(node: JSONContent): string {
  if (!node.content) return "";
  return node.content.map((c) => c.text || "").join("");
}

function getHeadingLevel(level: number | undefined): any {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    default:
      return HeadingLevel.HEADING_1;
  }
}

function getAlignment(align?: string): any {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    case "left":
    default:
      return AlignmentType.LEFT;
  }
}
