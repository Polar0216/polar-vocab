import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { vocabularyEntrySchema } from '../../../src/domain';
import { escapeSpreadsheetCell, exportVocabularyCsv } from '../../../src/features/import-export/export-service';

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}
const record = (lang: 'en' | 'de', lemma: string) => vocabularyEntrySchema.parse({ id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [], createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', lang, lemma, origin: 'manual', status: 'inbox' });

describe('CSV export', () => {
  it('round-trips commas, quotes, multiline text and German spelling with RFC quoting', async () => {
    const input = { ...record('de', 'größer'), meanings: ['更大,更高"'], contexts: [{ id: crypto.randomUUID(), text: 'line one\nline two' }], source: 'Numbers', tags: ['A1'] };
    const blob = exportVocabularyCsv([input]);
    expect(blob.type).toContain('charset=utf-8');
    const text = await blobText(blob);
    expect(text).toContain('"更大,更高"""');
    const rows = Papa.parse<Record<string, string>>(text, { header: true }).data;
    expect(rows[0].word).toBe('größer'); expect(rows[0].context).toBe('line one\nline two');
    expect(rows[0].source).toBe('Numbers');
  });
  it('filters languages and excludes deleted entries', async () => {
    const entries = [record('en', 'word'), record('de', 'Wort'), { ...record('en', 'deleted'), deletedAt: '2026-10-14T00:00:00.000Z' }];
    const text = await blobText(exportVocabularyCsv(entries, { language: 'en' }));
    expect(text).toContain('"word"'); expect(text).not.toContain('Wort'); expect(text).not.toContain('deleted');
  });
  it.each(['=cmd', '+SUM(A1)', '-1', '@evil', '\t=cmd', '\r=cmd', '  =cmd', '\n@cmd'])('protects formula-prefix text: %j', (text) => {
    expect(escapeSpreadsheetCell(text)).toBe(`'${text}`);
  });
  it('does not rewrite ordinary spelling or execute HTML', async () => {
    expect(escapeSpreadsheetCell('contribute to')).toBe('contribute to');
    const text = await blobText(exportVocabularyCsv([record('en', '<img src=x onerror=evil()>')]));
    expect(text).toContain('<img src=x onerror=evil()>');
  });
});
