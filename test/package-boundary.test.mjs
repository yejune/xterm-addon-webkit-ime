import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("git source contains every exported package file", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const path of [pkg.main, pkg.module, pkg.types]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
  }
});

test("the library owns one exact Xterm 6 build boundary", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
  const nodeVersion = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
  assert.equal(pkg.engines.node, nodeVersion);
  assert.match(pkg.packageManager, /^pnpm@\d+[.]\d+[.]\d+$/);
  assert.deepEqual(pkg.peerDependencies, { "@xterm/xterm": "6.0.0" });
  for (const target of ["preflight", "prepare", "build", "verify"]) {
    assert.match(makefile, new RegExp(`^${target}:`, "m"));
  }
  assert.equal(existsSync(new URL("../pnpm-lock.yaml", import.meta.url)), true);
});
