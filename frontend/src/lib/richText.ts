/*
 * Formatted text (product knowledge) is stored as a small, safe subset of HTML; the API cleans it
 * (App\Services\RichText). Plain text pasted from WA is converted the same way it is there.
 */

/** Typography for formatted text, both where it's read and inside the editor. */
export const richTextClass =
  "text-sm leading-relaxed break-words text-body [&>*+*]:mt-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:space-y-1 [&_ul,&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:border-border [&_a]:font-medium [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const marks = [
  ["\\*", "strong"],
  ["_", "em"],
  ["~", "s"],
] as const;

/** WA's *bold*, _italic_ and ~strike~, and http(s) links, on one line (markers inside links are left alone). */
function inline(line: string): string {
  return line
    .split(/(https?:\/\/\S+)/g)
    .map((part, index) => {
      const safe = escape(part);
      if (index % 2 === 1) return `<a href="${safe}">${safe}</a>`;
      return marks.reduce(
        (text, [m, tag]) => text.replace(new RegExp(`(?<![\\w${m}])${m}(?=\\S)([^${m}\\n]*?\\S)${m}(?![\\w${m}])`, "gu"), `<${tag}>$1</${tag}>`),
        safe
      );
    })
    .join("");
}

const bullet = /^\s*[-•*]\s+/;
const numbered = /^\s*\d+[.)]\s+/;

/** Plain text (WA formatting) as HTML: blank lines split paragraphs, "- " and "1. " lines make lists. */
export function waToHtml(text: string): string {
  let html = "";
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  for (const block of blocks) {
    let list: "ul" | "ol" | null = null;
    let lines: string[] = [];
    const flush = () => {
      if (lines.length === 0) return;
      const items = lines.map(inline);
      html += list ? `<${list}>${items.map((item) => `<li>${item}</li>`).join("")}</${list}>` : `<p>${items.join("<br>")}</p>`;
    };
    for (const line of block.split("\n")) {
      const type = bullet.test(line) ? "ul" : numbered.test(line) ? "ol" : null;
      if (type !== list) {
        flush();
        list = type;
        lines = [];
      }
      lines.push(type ? line.replace(type === "ul" ? bullet : numbered, "") : line);
    }
    flush();
  }
  return html;
}
