// Regenerates the PWA icon set in public/ from public/decimen_logo.svg:
//
//   deno task icons      (needs rsvg-convert on PATH — librsvg)
//
// Three variants come out of the one logo:
//  - icon-192 / icon-512: the logo tile as-is (rounded corners, purpose "any")
//  - icon-maskable-512: full-bleed square with the mark at 0.62, inside the
//    safe zone no launcher mask (circle, squircle, …) will clip
//  - apple-touch-icon (180): full-bleed square at 0.82 — iOS rounds the
//    corners itself, and transparent corners would come back black
//
// The logo's header comment says "--bg", and a double hyphen inside a comment
// is invalid XML: browsers shrug, librsvg refuses the whole file. Comments are
// stripped before rasterizing. The square variants are exact-match string
// surgery on the logo markup that throws when it misses — same contract as the
// build plugins, so a reshaped logo breaks this script rather than shipping a
// half-transformed icon.

import { fromFileUrl, join } from "@std/path";

const publicDir = fromFileUrl(new URL("../public", import.meta.url));
const logo = Deno.readTextFileSync(join(publicDir, "decimen_logo.svg"));
const cleaned = logo.replace(/<!--[\s\S]*?-->/g, "");

const ROUNDED_RECT = '<rect width="640" height="640" rx="112" fill="#070a11"/>';
const MARK_OPEN = '<g fill="#58c8ff" transform="translate(48.5,43)">';

function squareVariant(markScale: number): string {
  for (const needle of [ROUNDED_RECT, MARK_OPEN]) {
    if (!cleaned.includes(needle)) {
      throw new Error(`decimen_logo.svg changed shape — expected to find: ${needle}`);
    }
  }
  return cleaned
    .replace(ROUNDED_RECT, '<rect width="640" height="640" fill="#070a11"/>')
    .replace(
      MARK_OPEN,
      `<g transform="translate(320,320) scale(${markScale}) translate(-320,-320)">${MARK_OPEN}`,
    )
    .replace("</svg>", "</g></svg>");
}

/** Run rsvg-convert, throwing on a non-zero exit. Throws NotFound when the
 *  binary is missing. */
function rsvgConvert(args: string[], stderr: "inherit" | "null" = "inherit") {
  const { success, code } = new Deno.Command("rsvg-convert", { args, stdout: "null", stderr }).outputSync();
  if (!success) throw new Error(`rsvg-convert ${args.join(" ")} exited with ${code}`);
}

try {
  rsvgConvert(["--version"], "null");
} catch {
  throw new Error("rsvg-convert not found — install librsvg");
}

const work = Deno.makeTempDirSync({ prefix: "decimen-icons-" });

function render(svg: string, size: number, out: string) {
  const src = join(work, `${out}.svg`);
  Deno.writeTextFileSync(src, svg);
  rsvgConvert(["-w", String(size), "-h", String(size), src, "-o", join(publicDir, out)]);
  console.log(`public/${out} ${size}×${size}`);
}

try {
  render(cleaned, 192, "icon-192.png");
  render(cleaned, 512, "icon-512.png");
  render(squareVariant(0.62), 512, "icon-maskable-512.png");
  render(squareVariant(0.82), 180, "apple-touch-icon.png");
} finally {
  Deno.removeSync(work, { recursive: true });
}
