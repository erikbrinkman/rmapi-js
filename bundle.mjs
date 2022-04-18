import { pnpPlugin } from "@yarnpkg/esbuild-plugin-pnp";
import chalk from "chalk";
import { build } from "esbuild";
import { stat } from "node:fs/promises";
import { parse } from "node:path";
import { performance } from "perf_hooks";

const name = "rmapi-js";
const start = performance.now();

async function wrapper(options) {
  const res = await build(options);
  const { outfile } = options;
  const { size } = await stat(outfile);
  const { dir, base } = parse(outfile);
  console.log(
    chalk.white(`\n  ${dir}/`) + chalk.bold(`${base}`),
    chalk.cyan(` ${(size / 1024).toFixed(1)}kb`)
  );
  return res;
}

const config = {
  plugins: [pnpPlugin()],
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
};

await Promise.all([
  wrapper({
    ...config,
    platform: "node",
    outfile: `bundle/${name}.cjs.min.js`,
  }),
  wrapper({
    ...config,
    platform: "browser",
    globalName: "rmapi",
    outfile: `bundle/${name}.iife.min.js`,
  }),
  wrapper({
    ...config,
    platform: "neutral",
    outfile: `bundle/${name}.esm.min.js`,
  }),
]);

const elapsed = Math.round(performance.now() - start);
console.log("\n⚡", chalk.green(`Done in ${elapsed}ms`));
