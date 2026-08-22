export interface IDisposable {
    dispose(): void;
}
/** The subset of the xterm.js Terminal API this addon uses (structural). */
export interface ITerminalLike {
    readonly textarea?: HTMLTextAreaElement;
    readonly element?: HTMLElement;
    readonly cols: number;
    readonly rows: number;
    readonly options: {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
    };
    readonly buffer: {
        active: {
            readonly cursorX: number;
            readonly cursorY: number;
        };
    };
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
export declare function shouldFlushPendingForTerminalData(data: string): boolean;
export declare class WebkitImeAddon implements ITerminalAddon {
    private readonly _opts;
    private _term?;
    private _preedit?;
    private _onRender?;
    private _removers;
    private _composing;
    private _pending;
    private _expectEcho;
    private _justFlushed;
    private _flushingFromKeydown;
    constructor(_opts: WebkitImeAddonOptions);
    activate(terminal: ITerminalLike): void;
    dispose(): void;
    /** Call from terminal.onData — true if the data is leaked jamo to drop. */
    shouldSkip(data: string): boolean;
    /**
     * Commit any pending non-standard syllable immediately. Call this from
     * terminal.onData BEFORE forwarding a non-skipped chunk to the pty so the
     * composed syllable is ordered ahead of the following external input.
     *
     * GUARD 7: WKWebView routes a non-Hangul key pressed mid-composition (`.`,
     * `?`, `!`, punctuation, ASCII, paste) to the pty via xterm's textarea-poll
     * onData, which fires BEFORE the addon's keydown flush — so the char landed
     * before the pending syllable ("자" + "." -> ".자", "하" + "?" -> "?하").
     * Flushing here, on the same onData path that writes the char, guarantees the
     * correct order. No-op when nothing is pending.
     */
    flushPending(): void;
    /** True only when terminal.onData represents input that commits composition. */
    shouldFlushPending(data: string): boolean;
    private _customKey;
    private _onKeydown;
    private _onBeforeinput;
    private _onInput;
    private _place;
    private _clearOwnedTextarea;
    private _show;
    private _hide;
    private _flush;
}
