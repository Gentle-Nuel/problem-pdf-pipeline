// final_content always starts with a single "# Title" line — enforced by
// the drafting prompt in the main pipeline's lib/blogDraft.ts.
export function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "Untitled";
}

const MAX_DESCRIPTION_LENGTH = 155;

// Standard meta-description length is ~155-160 characters — truncate the
// first real paragraph (skipping the title line and any blank lines)
// rather than the whole post.
export function extractDescription(markdown: string): string {
  const withoutTitle = markdown.replace(/^#\s+.+$/m, "").trim();
  const firstParagraph = withoutTitle.split(/\n\s*\n/)[0] ?? "";
  const plain = firstParagraph
    .replace(/[#*_`>]/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > MAX_DESCRIPTION_LENGTH ? `${plain.slice(0, MAX_DESCRIPTION_LENGTH).trim()}…` : plain;
}
