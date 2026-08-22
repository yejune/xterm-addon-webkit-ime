import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("git source contains every exported package file", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const path of [pkg.main, pkg.module, pkg.types]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
  }
});
