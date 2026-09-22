/**
 * Builds the voting page into one self-contained HTML file: Alpine and the page's own
 * TypeScript inlined, no CDN and no second request, because the phones are on the venue's
 * wifi and not necessarily on the internet.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const PLACEHOLDER = "<!--script-->";

const { outputFiles } = await build({
  entryPoints: [new URL("server/vote.ts", root).pathname],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
});

const template = readFileSync(new URL("server/vote.html", root), "utf8");
if (!template.includes(PLACEHOLDER)) {
  throw new Error(`server/vote.html has no ${PLACEHOLDER} to put the script in`);
}
const script = outputFiles[0].text;
mkdirSync(new URL("dist/", root), { recursive: true });
writeFileSync(
  new URL("dist/vote.html", root),
  template.replace(PLACEHOLDER, () => `<script>${script}</script>`),
);
console.log(`[polls] dist/vote.html — ${Math.round(script.length / 1024)} kB of script`);
