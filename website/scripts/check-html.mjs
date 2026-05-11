// Naive HTML balance check for the landing page. Intentionally conservative:
// we only verify a handful of structural tags. Runs in Node without deps.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filename = path.resolve(here, "..", "index.html");
const html = readFileSync(filename, "utf-8");

const tags = ["details", "section", "header", "footer", "main", "table", "nav", "html", "body", "head"];
let failed = false;
for (const tag of tags) {
  // Opening tag: `<tag` followed by whitespace or `>` (but NOT a letter, to
  // avoid matching `<sections`). Closing tag: `</tag>` exactly.
  const open = (html.match(new RegExp(`<${tag}(?=[\\s>])`, "g")) ?? []).length;
  const close = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  if (open !== close) {
    console.error(`unbalanced <${tag}>: open=${open} close=${close}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("HTML balanced.");
