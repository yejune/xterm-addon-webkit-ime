import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("documents the Wails v3 generated-binding integration", () => {
  assert.match(readme, /### With Wails v3/);
  assert.match(
    readme,
    /bindings\/github\.com\/soksak-ai\/soksak-plugin-terminal-xterm\/service/,
  );
  assert.doesNotMatch(readme, /acme|example path|Replace the example path/);
  assert.match(readme, /TerminalService\.Open/);
  assert.match(readme, /TerminalService\.Write/);
  assert.match(readme, /writeTail = writeTail\s*\.then/);
  assert.match(readme, /ime\.shouldSkip/);
  assert.match(readme, /ime\.flushPending/);
});
