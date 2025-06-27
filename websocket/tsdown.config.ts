import { defineConfig } from "tsdown";
import { readFileSync } from "node:fs";

const packageVersion =
  process.env.npm_package_version ?? JSON.parse(readFileSync("./package.json", "utf-8")).version;

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: {
      tsconfig: "./tsconfig.json",
      sourcemap: true,
    },
    platform: "browser",
    sourcemap: true,
    clean: true, // (this is the default)
    // Compiled-in variables
    env: {
      npm_package_version: packageVersion,
    },
    attw: true,
  },
  {
    entry: ["src/node.ts"],
    format: ["cjs", "esm"], // this is a CLI tool
    dts: {
      tsconfig: "./tsconfig.json",
      sourcemap: true,
    },
    platform: "node",
    sourcemap: true,
    clean: true, // (this is the default)
    // Compiled-in variables
    env: {
      npm_package_version: packageVersion,
    },
  },
]);
