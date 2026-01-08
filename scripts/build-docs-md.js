#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";

const OUT_DIR = "docs-md";
const TARGET = "docs-md/docs.md"

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (e) => {
      const res = path.resolve(dir, e.name);
      return e.isDirectory() ? walk(res) : res;
    })
  );
  return files.flat();
};

const main = async () => {
  const exists = await fs
    .stat(OUT_DIR)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    console.error(`Missing ${OUT_DIR}. Run TypeDoc to generate Markdown first.`);
    process.exit(1);
  }

  const files = (await walk(OUT_DIR))
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const parts = [];
  for (const f of files) {
    let text = await fs.readFile(f, "utf8");
    text = text
      .replace(/<!--[\s\S]*?-->/g, "")
      // strip standalone HTML anchor tags like <a id="section"></a>
      .replace(/<a\s+id=['"][^'"]+['"]>\s*<\/a>/g, "")
      // rewrite GitHub blob links to relative repo paths
      .replace(/\(https:\/\/github\.com\/[^)]+\/blob\/[^/]+\/([^)]+)\)/g, "($1)")
      .replace(/\n{3,}/g, "\n\n");

    parts.push(
      `\n\n---\n\n<!-- source: ${path.relative(OUT_DIR, f)} -->\n\n` +
        text.trim()
    );
  }

  await fs.writeFile(TARGET, parts.join("\n"));
  console.log(`Wrote ${TARGET}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
