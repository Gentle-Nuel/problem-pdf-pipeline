import { marked } from "marked";
import { DISCLAIMER } from "./disclaimer.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildPdfHtml(title: string, markdownContent: string): string {
  const bodyHtml = marked.parse(markdownContent, { async: false }) as string;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.6; max-width: 680px; margin: 0 auto; padding: 48px 32px; }
  h1 { font-size: 28px; margin-bottom: 8px; }
  h2 { font-size: 20px; margin-top: 32px; border-bottom: 2px solid #ddd; padding-bottom: 6px; }
  .disclaimer { font-size: 13px; font-style: italic; color: #555; background: #f6f6f4; border-left: 3px solid #999; padding: 12px 16px; margin: 20px 0 32px; }
  a { color: #1a5fb4; }
  ul, ol { padding-left: 24px; }
  li { margin-bottom: 6px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="disclaimer">${escapeHtml(DISCLAIMER)}</div>
  ${bodyHtml}
</body>
</html>`;
}
