// Render `website/og.svg` to `website/og.png` (1200x630) using @resvg/resvg-js.
// resvg-js ships a WASM/native binding via node-gyp; ours is a dev dep, so the
// PNG is committed under `website/og.png` and the script is only re-run when
// the source SVG changes.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.resolve(here, "..", "og.svg");
const outPath = path.resolve(here, "..", "og.png");

const svg = readFileSync(svgPath, "utf-8");

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  background: "#0b1020",
  font: {
    // System fonts are good enough; the SVG falls back to system-ui.
    loadSystemFonts: true,
    defaultFontFamily: "Inter",
  },
});

const png = resvg.render().asPng();
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
