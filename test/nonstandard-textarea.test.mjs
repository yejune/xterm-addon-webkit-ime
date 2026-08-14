import assert from "node:assert/strict";
import test from "node:test";

import { WebkitImeAddon } from "../dist/index.js";

test("owned replacement text does not remain in xterm's native textarea", () => {
  const listeners = new Map();
  const textarea = {
    value: "ㅎ하한",
    parentElement: { appendChild() {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
  };
  const preedit = {
    style: {},
    textContent: "",
    remove() {},
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() { return preedit; },
    body: { appendChild() {} },
  };

  try {
    const addon = new WebkitImeAddon({ onData() {} });
    addon.activate({
      textarea,
      element: null,
      attachCustomKeyEventHandler() {},
      onRender() { return { dispose() {} }; },
      buffer: { active: { cursorX: 0, cursorY: 0 } },
      cols: 80,
      rows: 24,
      options: {},
    });

    listeners.get("input")({
      data: "한",
      inputType: "insertReplacementText",
      stopImmediatePropagation() {},
      preventDefault() {},
    });

    assert.equal(textarea.value, "");
    assert.equal(preedit.textContent, "한");
  } finally {
    globalThis.document = previousDocument;
  }
});
