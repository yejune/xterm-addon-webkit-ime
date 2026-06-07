// ============================================================================
// xterm-addon-webkit-ime
//
// Korean / CJK IME for xterm.js on WKWebView (Tauri, Safari) and other engines.
//
// WKWebView emits Korean IME input in TWO variants depending on whether the
// textarea's marked-text (composition) state is alive:
//
//   STANDARD  : compositionstart/update/end fire + input.inputType is
//               "insertCompositionText" / "insertFromComposition". xterm's own
//               CompositionHelper handles this — we leave it alone and read the
//               result via terminal.onData.
//
//   NON-STD   : NO compositionend; input.inputType is "insertReplacementText"
//               (and Hangul "insertText"). xterm drops these, so we intercept
//               them, buffer the syllable, draw an overlay preview at the cursor,
//               and flush the composed text on the next non-IME key.
//
// Philosophy: intercept ONLY the non-standard path; delegate the standard path
// to xterm. We also block keyCode 229 from leaking partial jamo, and shouldSkip()
// filters any jamo that still leaks through terminal.onData mid-composition.
//
// WebKit bug: https://bugs.webkit.org/show_bug.cgi?id=274700
//
// This file declares its own minimal structural types so it does not depend on a
// specific xterm version — works with xterm 5.x ("xterm") and 6.x ("@xterm/xterm").
// ============================================================================

export interface IDisposable {
  dispose(): void;
}

/** The subset of the xterm.js Terminal API this addon uses (structural). */
export interface ITerminalLike {
  readonly textarea?: HTMLTextAreaElement;
  readonly element?: HTMLElement;
  readonly cols: number;
  readonly rows: number;
  readonly options: { fontFamily?: string; fontSize?: number; lineHeight?: number };
  readonly buffer: { active: { readonly cursorX: number; readonly cursorY: number } };
  onRender(handler: () => void): IDisposable;
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void;
}

/** Matches xterm's ITerminalAddon so the instance can be passed to loadAddon. */
export interface ITerminalAddon {
  activate(terminal: ITerminalLike): void;
  dispose(): void;
}

export interface WebkitImeAddonOptions {
  /** Finalized text destined for the backend (typically your pty writer). */
  onData: (data: string) => void;
  /** Optional trace hook for debugging the IME pipeline. */
  onDebug?: (msg: string) => void;
}

function isHangul(text: string): boolean {
  if (!text) return false;
  const cp = text.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x3130 && cp <= 0x318f) || // Hangul Compatibility Jamo
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0xa960 && cp <= 0xa97f) || // Hangul Jamo Extended-A
    (cp >= 0xd7b0 && cp <= 0xd7ff) // Hangul Jamo Extended-B
  );
}

export class WebkitImeAddon implements ITerminalAddon {
  private _term?: ITerminalLike;
  private _preedit?: HTMLDivElement;
  private _onRender?: IDisposable;
  private _removers: Array<() => void> = [];
  // Non-standard (insertReplacementText) composition state. The standard path
  // never sets these — it is fully owned by xterm.
  private _composing = false;
  private _pending = "";

  constructor(private readonly _opts: WebkitImeAddonOptions) {}

  public activate(terminal: ITerminalLike): void {
    const ta = terminal.textarea;
    if (!ta) return;
    this._term = terminal;

    const preedit = document.createElement("div");
    preedit.style.position = "absolute";
    preedit.style.pointerEvents = "none";
    preedit.style.whiteSpace = "pre";
    preedit.style.zIndex = "5";
    preedit.style.color = "#fff";
    preedit.style.background = "rgb(47, 47, 47)";
    preedit.style.textDecoration = "underline";
    preedit.style.display = "none";
    (terminal.element ?? ta.parentElement ?? document.body).appendChild(preedit);
    this._preedit = preedit;

    const add = (type: string, fn: (e: Event) => void): void => {
      ta.addEventListener(type, fn, true);
      this._removers.push(() => ta.removeEventListener(type, fn, true));
    };

    // NOTE: we do NOT touch compositionstart/update/end — leaving them lets
    // WebKit keep its marked-text state on the STANDARD path that xterm handles.
    // We only intercept the non-standard input variants.
    add("input", this._onInput as (e: Event) => void);
    add("keydown", this._onKeydown as (e: Event) => void);

    // Block xterm's CompositionHelper from sending partial jamo on keyCode 229.
    terminal.attachCustomKeyEventHandler(this._customKey);

    this._onRender = terminal.onRender(() => {
      if (this._composing && this._pending) this._show(this._pending);
    });
  }

  public dispose(): void {
    for (const off of this._removers) off();
    this._removers = [];
    this._onRender?.dispose();
    this._onRender = undefined;
    this._preedit?.remove();
    this._preedit = undefined;
    // Release the custom key handler so it doesn't leak into another addon.
    this._term?.attachCustomKeyEventHandler(() => true);
    this._composing = false;
    this._pending = "";
  }

  /** Call from terminal.onData — true if the data is leaked jamo to drop. */
  public shouldSkip(data: string): boolean {
    return this._composing && data.length === 1 && isHangul(data);
  }

  private _customKey = (ev: KeyboardEvent): boolean => {
    if (ev.type === "keydown" && (ev.keyCode === 229 || ev.isComposing)) {
      return false; // block xterm's keydown processing for IME keys
    }
    return true;
  };

  private _onKeydown = (e: KeyboardEvent): void => {
    this._opts.onDebug?.(`KEY key=${JSON.stringify(e.key)} code=${e.keyCode} composing=${this._composing}`);

    if (e.keyCode === 229 || e.isComposing) {
      // Block CompositionHelper._handleAnyTextareaChanges (partial jamo leak).
      e.stopImmediatePropagation();
      return;
    }

    // Non-standard composition: a plain keyCode 8 backspace means a single jamo
    // is left and the IME emits no further input — clear it ourselves.
    if (e.key === "Backspace" && this._composing) {
      this._composing = false;
      this._pending = "";
      this._hide();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    // Any other key ends a non-standard composition: flush it, then let xterm
    // handle the key normally (no preventDefault) so it reaches onData.
    if (this._composing) this._flush();
  };

  private _onInput = (e: InputEvent): void => {
    this._opts.onDebug?.(
      `INPUT type=${e.inputType} data=${JSON.stringify(e.data)} composing=${this._composing} pending=${JSON.stringify(this._pending)}`,
    );

    // NON-STANDARD: composition update (ㅎ -> 하 -> 한). Intercept + preview.
    if (e.data && e.inputType === "insertReplacementText") {
      this._composing = true;
      this._pending = e.data;
      this._show(e.data);
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // NON-STANDARD: Hangul insertText starts a new composition.
    if (e.data && e.inputType === "insertText" && isHangul(e.data)) {
      if (this._composing) this._flush();
      this._composing = true;
      this._pending = e.data;
      this._show(e.data);
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // NON-STANDARD: backspace emptied the composition (deleteContentBackward or
    // empty insertReplacementText) — clear buffer + preview.
    if (
      this._composing &&
      (e.inputType === "deleteContentBackward" || (e.inputType === "insertReplacementText" && !e.data))
    ) {
      this._composing = false;
      this._pending = "";
      this._hide();
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // STANDARD path (insertCompositionText / insertFromComposition / plain text):
    // do NOT intercept — xterm handles it and emits onData. If a non-standard
    // composition was somehow open, flush it first.
    if (this._composing) this._flush();
  };

  private _place(): void {
    const term = this._term;
    const preedit = this._preedit;
    if (!term || !preedit) return;
    const core = (term as unknown as { _core?: any })._core;
    const cell = core?._renderService?.dimensions?.css?.cell;
    const el = term.element;
    const cw = cell?.width ?? (el ? el.clientWidth / term.cols : 9);
    const ch = cell?.height ?? (el ? el.clientHeight / term.rows : 17);
    const buf = term.buffer.active;
    const col = Math.min(buf.cursorX, term.cols - 1);
    const row = buf.cursorY; // viewport-relative
    preedit.style.left = `${col * cw}px`;
    preedit.style.top = `${row * ch}px`;
    preedit.style.height = `${ch}px`;
    preedit.style.lineHeight = `${ch}px`;
    preedit.style.fontFamily = term.options.fontFamily ?? "monospace";
    preedit.style.fontSize = `${term.options.fontSize ?? 15}px`;
  }

  private _show(text: string): void {
    if (!this._preedit) return;
    this._preedit.textContent = text;
    this._place();
    this._preedit.style.display = "block";
  }

  private _hide(): void {
    if (!this._preedit) return;
    this._preedit.textContent = "";
    this._preedit.style.display = "none";
  }

  private _flush(): void {
    if (!this._composing) return;
    const text = this._pending;
    this._composing = false;
    this._pending = "";
    this._hide();
    if (text) this._opts.onData(text);
  }
}
