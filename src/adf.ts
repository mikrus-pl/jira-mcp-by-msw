type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

export function plainTextToAdf(text: string): Record<string, unknown> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  return {
    type: "doc",
    version: 1,
    content: lines.map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : []
    }))
  };
}

export function adfToPlainText(document: unknown): string {
  if (!document || typeof document !== "object") {
    return "";
  }

  const root = document as AdfNode;
  const text = renderNode(root).replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

function renderNode(node: AdfNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  const children = Array.isArray(node.content) ? node.content.map(renderNode).join("") : "";

  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "codeBlock" ||
    node.type === "blockquote" ||
    node.type === "listItem"
  ) {
    return `${children}\n`;
  }

  return children;
}
