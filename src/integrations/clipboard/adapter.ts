import type { ClipboardPort, ClipboardReadResult } from './contracts';

export interface ClipboardEnvironment {
  readonly secureContext: boolean;
  readonly readText?: () => Promise<string>;
}

/** No constructor side effects, permission query, listeners or automatic reads. */
export class BrowserClipboardAdapter implements ClipboardPort {
  private readonly environment?: ClipboardEnvironment;
  constructor(environment?: ClipboardEnvironment) { this.environment = environment; }

  async readText(): Promise<ClipboardReadResult> {
    const secureContext = this.environment?.secureContext ?? globalThis.isSecureContext;
    if (!secureContext) return { status: 'unsupported', manualPasteRequired: true };
    const read = this.environment
      ? this.environment.readText
      : typeof navigator !== 'undefined' && navigator.clipboard?.readText
        ? () => navigator.clipboard.readText()
        : undefined;
    if (!read) return { status: 'unsupported', manualPasteRequired: true };
    try {
      // Invoke before any await so the browser can retain the caller's click activation.
      const operation = read();
      const text = (await operation).trim();
      return text ? { status: 'success', text } : { status: 'empty', manualPasteRequired: true };
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
      return { status: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed', manualPasteRequired: true };
    }
  }
}
