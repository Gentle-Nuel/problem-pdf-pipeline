// final_content always starts with a single "# Title" line — constructed
// directly by the main pipeline's lib/generateBlogPosts.ts.
export function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "Untitled";
}

const MAX_DESCRIPTION_LENGTH = 155;

// Standard meta-description length is ~155-160 characters — truncate the
// first real prose paragraph (skipping the title line, blank lines, and
// any section headers) rather than the whole post.
//
// Confirmed live this needed the header-skip: since the main pipeline's
// excerpt-based blog generation (lib/excerpt.ts) always starts the body
// with "## Section Header\n\n<prose>", the naive "first blank-line-
// separated chunk" was the isolated header line itself — every page's
// meta description and og:description were shipping the literal string
// "Short Answer" (or whatever the first section happened to be called)
// instead of any actual content, silently undermining the SEO this layer
// exists for.
export function extractDescription(markdown: string): string {
  const withoutTitle = markdown.replace(/^#\s+.+$/m, "").trim();
  const paragraphs = withoutTitle
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const firstProseParagraph = paragraphs.find((p) => !/^#{1,6}\s/.test(p)) ?? paragraphs[0] ?? "";
  const plain = firstProseParagraph
    .replace(/[#*_`>]/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > MAX_DESCRIPTION_LENGTH ? `${plain.slice(0, MAX_DESCRIPTION_LENGTH).trim()}…` : plain;
}
