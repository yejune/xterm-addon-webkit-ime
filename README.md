# xterm-addon-webkit-ime

An [xterm.js](https://xtermjs.org) addon that fixes **Korean / CJK IME input on WKWebView** (Wails, Tauri, Safari) and other engines — with a cursor-anchored composition preview and working composition backspace.

No xterm fork, no patch. Drop-in addon (`term.loadAddon(...)`), works with xterm **5.x** (`xterm`) and **6.x** (`@xterm/xterm`). Zero runtime dependencies.

## The problem

WKWebView (Wails / Tauri / Capacitor / Safari) does **not** fire reliable `compositionstart`/`compositionend` events for Korean IME. Instead it emits input events in one of two variants depending on its marked-text state:

| Variant | What you see | xterm alone |
|---|---|---|
| **standard** | `insertCompositionText` (composing) → `insertFromComposition` (commit) | handled correctly |
| **non‑standard** | `insertText` (jamo) → `insertReplacementText` (syllable updates), **no `compositionend`** | **dropped** → only raw jamo (ㅎㅏㄴ) reach the terminal |

This addon intercepts **only the non-standard variant**, buffers the composing syllable, draws an overlay preview at the cursor, and flushes the finalized text. The standard variant is left to xterm. It also blocks `keyCode 229` from leaking partial jamo.

## Install

```sh
npm install xterm-addon-webkit-ime
```

## Usage

```ts
import { Terminal } from "@xterm/xterm";      // or "xterm" for 5.x
import { WebkitImeAddon } from "xterm-addon-webkit-ime";

const term = new Terminal();
term.open(document.getElementById("terminal")!);

// `onData` receives finalized text — send it to your backend / pty.
const ime = new WebkitImeAddon({
  onData: (data) => sendToPty(data),
});
term.loadAddon(ime);

// Route xterm's own data (standard composition, plain keys) through the same
// sink. shouldSkip() drops jamo that leaks mid-composition; flushPending()
// commits a pending syllable before the external char so order is preserved
// ("자" + "." -> "자.", not ".자").
term.onData((data) => {
  if (ime.shouldSkip(data)) return;
  if (ime.shouldFlushPending(data)) ime.flushPending();
  sendToPty(data);
});
```

### With Tauri

```ts
import { invoke } from "@tauri-apps/api";

let writeTail: Promise<void> = Promise.resolve();
const sendToPty = (data: string): void => {
  writeTail = writeTail
    .then(() => invoke("async_write_to_pty", { data }))
    .catch((error) => console.error("pty write failed", error));
};

const ime = new WebkitImeAddon({ onData: sendToPty });
term.loadAddon(ime);
term.onData((data) => {
  if (ime.shouldSkip(data)) return;
  if (ime.shouldFlushPending(data)) ime.flushPending();
  sendToPty(data);
});
```

### With Wails v3

Wails generates the binding import path from the registered Go service package.
This example uses the real
[`soksak-plugin-terminal-xterm`](https://github.com/soksak-ai/soksak-plugin-terminal-xterm)
service; Wails writes this module under the application's `frontend/bindings`.

```ts
import * as TerminalService from
  "../bindings/github.com/soksak-ai/soksak-plugin-terminal-xterm/service";

const handle = await TerminalService.Open("terminal-1", term.cols, term.rows);

// Both the addon's finalized IME data and xterm's ordinary data must use one
// ordered queue. A rejected write is reported and does not poison later writes.
let writeTail: Promise<void> = Promise.resolve();
const sendToPty = (data: string): void => {
  writeTail = writeTail
    .then(() => TerminalService.Write(handle, data))
    .catch((error) => console.error("pty write failed", error));
};

const ime = new WebkitImeAddon({ onData: sendToPty });
term.loadAddon(ime);
term.onData((data) => {
  if (ime.shouldSkip(data)) return;
  if (ime.shouldFlushPending(data)) ime.flushPending();
  sendToPty(data);
});
```

The addon is independent of Wails service registration. The application owns
the PTY service and passes its generated `Write` binding to the addon's data
sink. No DOM mutation or synthetic input is required.

> Serialize pty writes in every framework integration. Two quick writes can
> otherwise race and arrive out of order (e.g. `한 글` instead of `한글 `).

### Cleanup

```ts
ime.dispose(); // removes listeners + overlay, resets the custom key handler
```

## API

```ts
new WebkitImeAddon(options: {
  onData: (data: string) => void;   // required — finalized text sink
  onDebug?: (msg: string) => void;  // optional — trace the IME pipeline
});

ime.shouldSkip(data: string): boolean;  // call from term.onData to drop leaked jamo
ime.shouldFlushPending(data: string): boolean; // false for terminal protocol replies
ime.flushPending(): void;               // call before forwarding user-originated data
                                        // chunk so a pending syllable is ordered first
ime.dispose(): void;
```

## How it works

- **Standard variant** → delegated to xterm (its `CompositionHelper` already handles `insertCompositionText`/`insertFromComposition`). The addon stays out of the way and reads the result via `term.onData`.
- **Non-standard variant** → `insertReplacementText` / Hangul `insertText` are intercepted, buffered, and previewed in an underlined overlay at the cursor cell. The composed syllable is flushed to `onData` on the next non-IME key, a new composition, or a plain character.
- Once the addon owns a non-standard input event, it clears xterm's hidden
  textarea. This prevents WebKit marked text from accumulating beside a TUI's
  own rendered input while the addon preview remains the sole preedit owner.
- **`keyCode 229`** is blocked (via `attachCustomKeyEventHandler` + capture-phase `stopImmediatePropagation`) so xterm's `CompositionHelper` does not emit partial jamo.
- **Backspace during a non-standard composition**: a single jamo that the IME can no longer decompose emits no further input event, so the addon clears the buffer itself.

## Known limitation

Deleting the **last jamo of a composition on the standard path** shows a brief cursor flicker — WebKit commits the syllable (echoed by the pty) and then deletes it, a two-step the engine performs. This is inherent to DOM/pty terminals (input and display are separate layers) and affects xterm's standard handling regardless of this addon. The overlay (non-standard path) avoids it because the syllable never reaches the pty until commit.

The underlying WebKit behaviour is tracked as [WebKit bug 274700](https://bugs.webkit.org/show_bug.cgi?id=274700).

## License

MIT
