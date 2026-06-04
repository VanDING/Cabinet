// Type stubs for xterm.js — optional dependency.
// Install with: npm install xterm xterm-addon-fit
declare module 'xterm' {
  export class Terminal {
    constructor(opts?: Record<string, unknown>);
    open(el: HTMLElement): void;
    dispose(): void;
    write(data: string): void;
    writeln(data: string): void;
    loadAddon(addon: unknown): void;
    onData(cb: (data: string) => void): void;
    onSelectionChange(cb: () => void): void;
    getSelection(): string;
    focus(): void;
    resize(cols: number, rows: number): void;
  }
}
declare module 'xterm-addon-fit' {
  export class FitAddon {
    activate(terminal: unknown): void;
    fit(): void;
    dispose(): void;
  }
}
