import assert from "node:assert/strict";
import test from "node:test";

import { shouldFlushPendingForTerminalData } from "../dist/index.js";

test("terminal protocol replies do not commit an active IME composition", () => {
  const protocolReplies = [
    "\u001b[?30;3R",
    "\u001b[?1;2c",
  ];

  for (const data of protocolReplies) {
    assert.equal(shouldFlushPendingForTerminalData(data), false, data);
  }

  assert.equal(shouldFlushPendingForTerminalData(" "), true);
  assert.equal(shouldFlushPendingForTerminalData("."), true);
  assert.equal(shouldFlushPendingForTerminalData("\r"), true);
});
