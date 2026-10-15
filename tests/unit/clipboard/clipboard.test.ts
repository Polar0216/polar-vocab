import { describe, expect, it, vi } from 'vitest';
import { BrowserClipboardAdapter } from '../../../src/integrations/clipboard/adapter';
import { parseClipboardText } from '../../../src/integrations/clipboard/preview';

describe('explicit clipboard adapter', () => {
  it('does not read on construction and invokes the API immediately when called', async () => {
    const readText = vi.fn().mockResolvedValue('  größer  ');
    const adapter = new BrowserClipboardAdapter({ secureContext: true, readText });
    expect(readText).not.toHaveBeenCalled();
    const result = adapter.readText();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(await result).toEqual({ status: 'success', text: 'größer' });
  });
  it.each(['NotAllowedError', 'SecurityError'])('provides manual fallback for %s', async (name) => {
    const adapter = new BrowserClipboardAdapter({ secureContext: true, readText: () => Promise.reject(new DOMException('denied', name)) });
    expect(await adapter.readText()).toEqual({ status: 'denied', manualPasteRequired: true });
  });
  it('handles unsupported, insecure, empty and failed reads', async () => {
    expect(await new BrowserClipboardAdapter({ secureContext: true }).readText()).toMatchObject({ status: 'unsupported' });
    const read = vi.fn().mockResolvedValue('word');
    expect(await new BrowserClipboardAdapter({ secureContext: false, readText: read }).readText()).toMatchObject({ status: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
    expect(await new BrowserClipboardAdapter({ secureContext: true, readText: async () => ' \n ' }).readText()).toMatchObject({ status: 'empty', manualPasteRequired: true });
    expect(await new BrowserClipboardAdapter({ secureContext: true, readText: async () => { throw new Error('failed'); } }).readText()).toMatchObject({ status: 'failed', manualPasteRequired: true });
  });
});

describe('clipboard text preview', () => {
  it('preserves a whole phrase as one editable entry', () => {
    const preview = parseClipboardText('  contribute to society  ', 'en');
    expect(preview.kind).toBe('single'); expect(preview.rows[0].payload.lemma).toBe('contribute to society');
    expect(preview.rows).toHaveLength(1);
  });
  it('splits only physical newline boundaries and preserves German characters', () => {
    const preview = parseClipboardText('Straße\n\ngrößer\r\nEntscheidung', 'de');
    expect(preview.kind).toBe('batch');
    expect(preview.rows.map((row) => row.rowNumber)).toEqual([1, 3, 4]);
    expect(preview.rows.map((row) => row.payload.lemma)).toEqual(['Straße', 'größer', 'Entscheidung']);
  });
  it('accepts TSV with standard headers or fixed headerless word/lang/meaning columns', () => {
    const preview = parseClipboardText('word\tlang\tmeaning\tsource\nWort\tde\t词\tSafari', 'en');
    expect(preview.rows[0].payload).toMatchObject({ lemma: 'Wort', lang: 'de', meanings: ['词'], source: 'Safari' });
    expect(preview.rows[0].payload.contexts).toBeUndefined();
    const plain = parseClipboardText('word\ten\t词\nWort\tde\t德文词', 'en');
    expect(plain.rows).toHaveLength(2);
  });
  it('reports invalid language and oversized row, without any persistence', () => {
    const preview = parseClipboardText('bad\tfr\n' + 'a'.repeat(501) + '\ten', 'en');
    expect(preview.rows).toHaveLength(0); expect(preview.issues.map((issue) => issue.rowNumber)).toEqual([1, 2]);
    expect(parseClipboardText('', 'de').rows).toEqual([]);
  });
});
