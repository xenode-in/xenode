import { JSONContent } from "@tiptap/react";

/**
 * officeASTToTiptapJSON
 * Converts the hierarchical AST from officeparser into a TipTap-compatible JSON structure.
 */
export function officeASTToTiptapJSON(ast: any): JSONContent {
  const content: JSONContent[] = [];

  if (!ast || !ast.content) {
    return { type: "doc", content: [] };
  }

  // Grouping pass: adjacent 'list' nodes with same ID should be grouped
  const groupedNodes: any[] = [];
  let currentList: any = null;

  for (const node of ast.content) {
    if (node.type === "list") {
      const listId = node.metadata?.listId || "default";
      const listType = node.metadata?.listType || "unordered";

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
  const defaultFont = ast.metadata?.formatting?.font || 
                      ast.metadata?.styleMap?.Normal?.formatting?.font || 
                      "Calibri";
  
  const rawSize = ast.metadata?.formatting?.size || 
                  ast.metadata?.styleMap?.Normal?.formatting?.size || 
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

function mapOfficeNodeToTiptap(node: any): JSONContent | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.level || 1 },
        content: mapChildren(node.children || node.text),
      };

    case "paragraph": {
      const firstChild = Array.isArray(node.children) ? node.children[0] : null;
      if (firstChild?.formatting?.size) {
        const sizePt = parseInt(firstChild.formatting.size) / 2; // half-points
        if (sizePt >= 24)
          return {
            type: "heading",
            attrs: { level: 1 },
            content: mapChildren(node.children),
          };
        if (sizePt >= 18)
          return {
            type: "heading",
            attrs: { level: 2 },
            content: mapChildren(node.children),
          };
        if (sizePt >= 14)
          return {
            type: "heading",
            attrs: { level: 3 },
            content: mapChildren(node.children),
          };
      }

      // Preserve text alignment
      const align = node.metadata?.alignment; // "left" | "center" | "right" | "justify"
      return {
        type: "paragraph",
        attrs: align ? { textAlign: align } : {},
        content: mapChildren(node.children || node.text),
      };
    }

    case "list_container": {
      return {
        type: node.listType === "ordered" ? "orderedList" : "bulletList",
        content: node.items.map((item: any) => ({
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
      const rows = (node.rows || node.children || []).filter((r: any) => r);
      if (rows.length === 0) return null;
      return {
        type: "table",
        content: rows.map((row: any) => ({
          type: "tableRow",
          content: (row.cells || row.children || []).map((cell: any) => {
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

function mapChildren(children: any): JSONContent[] {
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
          const marks: any[] = [];
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
