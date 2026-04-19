import { JSONContent } from "@tiptap/react";

/**
 * Office AST Node structure from officeparser
 */
interface OfficeNode {
  type: string;
  text?: string;
  children?: (OfficeNode | string)[];
  metadata?: Record<string, unknown>;
  formatting?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    size?: string;
    color?: string;
    font?: string;
  };
  level?: number;
  rows?: OfficeNode[];
  cells?: OfficeNode[];
  items?: OfficeNode[];
  src?: string;
  rawContent?: string;
}

interface GroupedListNode {
  type: "list_container";
  listType: string;
  listId: string;
  items: OfficeNode[];
}

type ProcessingNode = OfficeNode | GroupedListNode | string;

/**
 * officeASTToTiptapJSON
 * Converts the hierarchical AST from officeparser into a TipTap-compatible JSON structure.
 */
export function officeASTToTiptapJSON(ast: { content: OfficeNode[]; metadata?: Record<string, unknown> }): JSONContent {
  const content: JSONContent[] = [];

  if (!ast || !ast.content) {
    return { type: "doc", content: [] };
  }

  // Grouping pass: adjacent 'list' nodes with same ID should be grouped
  const groupedNodes: ProcessingNode[] = [];
  let currentList: GroupedListNode | null = null;

  for (const node of ast.content) {
    if (node.type === "list") {
      const listId = (node.metadata?.listId as string) || "default";
      const listType = (node.metadata?.listType as string) || "unordered";

      if (currentList && currentList.listId === listId) {
        currentList.items.push(node);
      } else {
        currentList = {
          type: "list_container",
          listType,
          listId,
          items: [node],
        };
        groupedNodes.push(currentList);
      }
    } else {
      currentList = null;
      groupedNodes.push(node);
    }
  }

  for (const node of groupedNodes) {
    const tiptapNode = mapOfficeNodeToTiptap(node);
    if (tiptapNode) {
      if (Array.isArray(tiptapNode)) {
        content.push(...tiptapNode);
      } else {
        content.push(tiptapNode);
      }
    }
  }

  // Extract default font from metadata
  const meta = ast.metadata as any;
  const defaultFont = meta?.formatting?.font || 
                      meta?.styleMap?.Normal?.formatting?.font || 
                      "Calibri";
  
  const rawSize = meta?.formatting?.size || 
                  meta?.styleMap?.Normal?.formatting?.size || 
                  "11pt";
  
  // Convert pt to px for the editor base
  const defaultSizePx = `${Math.round(parseInt(rawSize) * 1.333)}px`;

  return {
    type: "doc",
    content,
    metadata: {
      defaultFont,
      defaultSize: rawSize,
      defaultSizePx
    }
  };
}

function mapOfficeNodeToTiptap(node: ProcessingNode): JSONContent | null {
  if (typeof node === "string") {
    return { type: "text", text: node };
  }

  switch (node.type) {
    case "heading": {
      const officeNode = node as OfficeNode;
      return {
        type: "heading",
        attrs: { level: officeNode.level || 1 },
        content: mapChildren(officeNode.children || officeNode.text),
      };
    }

    case "paragraph": {
      const officeNode = node as OfficeNode;
      const firstChild = Array.isArray(officeNode.children) ? officeNode.children[0] : null;
      
      if (firstChild && typeof firstChild !== "string" && firstChild.formatting?.size) {
        const sizePt = parseInt(firstChild.formatting.size) / 2; // half-points
        if (sizePt >= 24)
          return {
            type: "heading",
            attrs: { level: 1 },
            content: mapChildren(officeNode.children),
          };
        if (sizePt >= 18)
          return {
            type: "heading",
            attrs: { level: 2 },
            content: mapChildren(officeNode.children),
          };
        if (sizePt >= 14)
          return {
            type: "heading",
            attrs: { level: 3 },
            content: mapChildren(officeNode.children),
          };
      }

      // Preserve text alignment
      const align = officeNode.metadata?.alignment; // "left" | "center" | "right" | "justify"
      return {
        type: "paragraph",
        attrs: align ? { textAlign: align } : {},
        content: mapChildren(officeNode.children || officeNode.text),
      };
    }

    case "list_container": {
      const listNode = node as GroupedListNode;
      return {
        type: listNode.listType === "ordered" ? "orderedList" : "bulletList",
        content: listNode.items.map((item) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: mapChildren(item.children || item.text || []),
            },
          ],
        })),
      };
    }
    case "table": {
      const officeNode = node as OfficeNode;
      const rows = (officeNode.rows || officeNode.children || []).filter((r): r is OfficeNode => typeof r !== "string" && !!r);
      if (rows.length === 0) return null;
      return {
        type: "table",
        content: rows.map((row) => ({
          type: "tableRow",
          content: (row.cells || row.children || []).map((cell) => {
            if (typeof cell === "string") {
               return { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: cell }] }] };
            }
            const children = mapChildren(cell.children || cell.text || []);
            // TipTap table cells MUST contain block nodes (like paragraphs)
            const wrappedContent = children.some(
              (c) => c.type === "paragraph" || c.type === "heading",
            )
              ? children
              : [{ type: "paragraph", content: children }];

            return {
              type: cell.metadata?.row === 0 ? "tableHeader" : "tableCell",
              content: wrappedContent,
            };
          }),
        })),
      };
    }

    default:
      // Fallback for simple text nodes or unknown types
      if (typeof node === "string") {
        return { type: "text", text: node };
      }
      return null;
  }
}

function mapChildren(children: (OfficeNode | string)[] | string | undefined): JSONContent[] {
  if (!children) return [];
  if (typeof children === "string") {
    return [{ type: "text", text: children }];
  }

  if (Array.isArray(children)) {
    return children
      .map((child) => {
        if (typeof child === "string") {
          return { type: "text", text: child };
        }

        if (child.type === "text") {
          const marks: JSONContent[] = [];
          const f = child.formatting || {};

          if (f.bold) marks.push({ type: "bold" });
          if (f.italic) marks.push({ type: "italic" });
          if (f.underline) marks.push({ type: "underline" });
          if (f.strike) marks.push({ type: "strike" });

          // Carry through font size, color, font family
          const styleAttrs: Record<string, string> = {};
          if (f.size)
            styleAttrs.fontSize = `${Math.round(parseInt(f.size) * 1.333)}px`; // Industry standard point to pixel conversion
          if (f.color && f.color !== "auto") styleAttrs.color = `#${f.color}`;
          if (f.font) styleAttrs.fontFamily = f.font;

          if (Object.keys(styleAttrs).length > 0) {
            marks.push({ type: "textStyle", attrs: styleAttrs });
          }

          return {
            type: "text",
            text: child.text || "",
            marks: marks.length > 0 ? marks : undefined,
          };
        }

        if (child.type === "image") {
          return {
            type: "image",
            attrs: {
              src:
                child.src ||
                "https://placehold.co/600x400/f3f4f6/3b82f6?text=Image",
              alt: child.text || "Image",
            },
          };
        }

        // Handle horizontal rules (often picts in Word)
        if (child.type === "image" && child.rawContent?.includes("<v:rect")) {
          return { type: "horizontalRule" };
        }

        // For nested blocks inside containers (e.g. in cells)
        return mapOfficeNodeToTiptap(child);
      })
      .filter(Boolean) as JSONContent[];
  }

  return [];
}
