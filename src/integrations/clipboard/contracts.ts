/** Phase 1 boundary. A caller must invoke this directly from an explicit user gesture. */
export type ClipboardReadResult =
  | { readonly status: 'success'; readonly text: string }
  | { readonly status: 'denied' | 'unsupported' | 'failed' | 'empty'; readonly manualPasteRequired: true };

export interface ClipboardPort {
  readText(): Promise<ClipboardReadResult>;
}
