import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { vocabularyEntrySchema } from '../../../src/domain';
import { LocalFileImportService, parseImportedDate } from '../../../src/features/import-export/import-service';
import { assertXlsxArchiveBudget, IMPORT_LIMITS } from '../../../src/features/import-export/limits';

function file(text: string | Uint8Array, name = 'words.csv'): File {
  const content = typeof text === 'string' ? text : new Uint8Array(text).buffer;
  return new File([content], name);
}
function service() {
  const vocabulary = { list: vi.fn().mockResolvedValue([]), commitImport: vi.fn().mockResolvedValue({ added: 1, updated: 0, skipped: 0 }) };
  return { importer: new LocalFileImportService(vocabulary), vocabulary };
}
const options = { defaultLanguage: 'en' as const, mapping: {} };
const xml = (text: string) => strToU8(text);
const cell = (address: string, text: string) => `<c r="${address}" t="inlineStr"><is><t>${text}</t></is></c>`;
function workbookFixture(): Uint8Array {
  const date = (Date.UTC(2026, 9, 14) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="English" sheetId="1" r:id="rId1"/><sheet name="Deutsch" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C2"/><sheetData><row r="1">${cell('A1', 'word')}${cell('B1', 'lang')}${cell('C1', 'created_at')}</row><row r="2">${cell('A2', 'contribute')}${cell('B2', 'en')}<c r="C2" s="1"><v>${date}</v></c></row></sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetData><row r="1">${cell('A1', 'word')}${cell('B1', 'lang')}${cell('C1', 'meaning')}</row><row r="2">${cell('A2', 'Entscheidung')}${cell('B2', 'de')}${cell('C2', '决定')}</row><row r="3">${cell('A3', 'größer')}${cell('B3', 'de')}</row></sheetData></worksheet>`),
  });
}

describe('local file preview boundary', () => {
  it('parses BOM/CRLF, quotes, commas and multiline fields with physical row numbers', async () => {
    const { importer, vocabulary } = service();
    const preview = await importer.preview(file('\uFEFFword,lang,meaning,context,source,tags,created_at\r\ncontribute,en,"贡献,帮助""他人","first\r\nsecond",Numbers,CET6,2026-10-14\r\nbroken,fr,,,,,\r\n'), options);
    expect(preview.totalRows).toBe(2);
    expect(preview.validRows).toBe(1); expect(preview.invalidRows).toBe(1);
    expect(preview.rows[0].rowNumber).toBe(2);
    expect(preview.issues[0].rowNumber).toBe(4);
    expect(preview.issues[0].field).toBe('lang');
    expect(preview.rows[0].payload.meanings).toEqual(['贡献,帮助"他人']);
    expect(preview.rows[0].payload.contexts?.[0].text).toBe('first\r\nsecond');
    expect(preview.rows[0].payload.source).toBe('Numbers');
    expect(preview.rows[0].createdAt).toBe('2026-10-14T00:00:00.000Z');
    expect(vocabulary.commitImport).not.toHaveBeenCalled();
  });
  it('supports Numbers semicolon CSV, minimal columns and source without invented context', async () => {
    const { importer } = service();
    const preview = await importer.preview(file('word;lang;source\nEntscheidung;de;Numbers'), options);
    expect(preview.rows[0].payload).toMatchObject({ lemma: 'Entscheidung', lang: 'de', source: 'Numbers' });
    expect(preview.rows[0].payload.contexts).toBeUndefined();
    const minimal = await importer.preview(file('word\nword pair'), { ...options, defaultLanguage: 'de' });
    expect(minimal.rows[0].payload).toEqual({ lemma: 'word pair', lang: 'de' });
  });
  it('permits mapping and headerless input without dropping the first word', async () => {
    const { importer } = service();
    const preview = await importer.preview(file('language,Original,释义\nde,größer,更大'), { ...options, mapping: { word: 'Original' } });
    expect(preview.rows[0].payload.lemma).toBe('größer');
    const noHeader = await importer.preview(file('alpha\nbeta'), options);
    expect(noHeader.rows.map((row) => row.payload.lemma)).toEqual(['alpha', 'beta']);
  });
  it('rejects invalid dates, blank lemmas and unknown language per row', async () => {
    const { importer } = service();
    const preview = await importer.preview(file('word,lang,created_at\na,en,2026-02-30\n,de,\nb,es,\nc,en,2026-10-14T10:00:00'), options);
    expect(preview.validRows).toBe(0); expect(preview.invalidRows).toBe(4);
    expect(preview.issues.map((issue) => issue.rowNumber)).toEqual([2, 3, 4, 5]);
  });
  it('detects existing and intra-file duplicate suggestions, separating languages', async () => {
    const { importer, vocabulary } = service();
    vocabulary.list.mockResolvedValue([vocabularyEntrySchema.parse({ id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [], createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', lang: 'de', lemma: 'Entscheidung', origin: 'manual', status: 'inbox' })]);
    const preview = await importer.preview(file('word,lang\ndie Entscheidung,de\nEntscheidung,de\nEntscheidung,en'), options);
    expect(preview.duplicateRows).toBe(2);
    expect(preview.rows[1].possibleDuplicateIds).toContain(preview.rows[0].rowId);
    expect(preview.rows[2].possibleDuplicateIds).toEqual([]);
  });
  it('TXT preserves phrases and blank physical lines and stable batch IDs during re-preview', async () => {
    const { importer } = service();
    const input = file('a phrase\n\nStraße\n', 'words.txt');
    const first = await importer.preview(input, options), again = await importer.preview(input, options);
    expect(first.rows.map((row) => row.rowNumber)).toEqual([1, 3]);
    expect(first.rows.map((row) => row.payload.lemma)).toEqual(['a phrase', 'Straße']);
    expect(first.batchId).toBe(again.batchId);
    expect(first.rows[0].rowId).toBe(again.rows[0].rowId);
    expect(first.rows[0].capturedAt).toBe(again.rows[0].capturedAt);
  });
  it('commit delegates exactly once and propagates transaction failures', async () => {
    const { importer, vocabulary } = service();
    const preview = await importer.preview(file('word\na'), options);
    expect(await importer.commit(preview, {})).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(vocabulary.commitImport).toHaveBeenCalledWith(preview, {});
    vocabulary.commitImport.mockRejectedValue(new Error('storage failed'));
    await expect(importer.commit(preview, {})).rejects.toThrow('storage failed');
  });
  it('returns malformed quote issues instead of accepting the row', async () => {
    const { importer } = service();
    const preview = await importer.preview(file('word,lang\n"unterminated,en'), options);
    expect(preview.invalidRows).toBe(1);
    expect(preview.issues.some((issue) => issue.rowNumber === 2)).toBe(true);
  });
  it('rejects unsupported, oversized, empty, and too many row files before committing', async () => {
    const { importer, vocabulary } = service();
    await expect(importer.readTable(file('word', 'words.numbers'))).rejects.toThrow('Numbers');
    await expect(importer.readTable(file('word', 'words.json'))).rejects.toThrow('备份恢复');
    await expect(importer.readTable(new File(['word'], 'words.csv', { type: 'image/png' }))).rejects.toThrow('类型与扩展名');
    await expect(importer.readTable(file(''))).rejects.toThrow('为空');
    await expect(importer.readTable(file('a'.repeat(IMPORT_LIMITS.fileBytes + 1)))).rejects.toThrow('5 MiB');
    await expect(importer.readTable(file('word\n' + Array(5_001).fill('a').join('\n')))).rejects.toThrow('5,000');
    expect(vocabulary.commitImport).not.toHaveBeenCalled();
  });
  it('bounds duplicate suggestions for a full 5,000-row repeated file', async () => {
    const { importer } = service();
    const preview = await importer.preview(file('word\n' + Array(5_000).fill('same').join('\n')), options);
    expect(preview.validRows).toBe(5_000); expect(preview.duplicateRows).toBe(4_999);
    expect(preview.rows.at(-1)!.possibleDuplicateIds).toHaveLength(10);
  });
  it('reads real local XLSX sheets, date cells and multiple German rows', async () => {
    const { importer } = service();
    const input = file(workbookFixture(), 'words.xlsx');
    const table = await importer.readTable(input);
    expect(table.sheetNames).toEqual(['English', 'Deutsch']);
    const english = await importer.preview(input, options);
    expect(english.rows[0].createdAt).toBe('2026-10-14T00:00:00.000Z');
    const german = await importer.preview(input, { ...options, sheetName: 'Deutsch' });
    expect(german.rows.map((row) => row.payload.lemma)).toEqual(['Entscheidung', 'größer']);
    expect(german.rows[0].payload.lang).toBe('de');
    await expect(importer.readTable(input, 'absent')).rejects.toThrow('找不到');
  });
});

describe('archive and date guards', () => {
  it('rejects invalid archive and declared decompression bomb', async () => {
    await expect(assertXlsxArchiveBudget(strToU8('not a ZIP'))).rejects.toThrow('压缩结构');
    const bomb = zipSync({ '[Content_Types].xml': xml('types'), 'xl/workbook.xml': xml('workbook'), 'xl/large.xml': new Uint8Array(IMPORT_LIMITS.xlsxEntryBytes + 1) });
    await expect(assertXlsxArchiveBudget(bomb)).rejects.toThrow('解压预算');
  });
  it('rejects forged small uncompressed size using actual streaming output', async () => {
    const bytes = zipSync({ '[Content_Types].xml': xml('types'), 'xl/workbook.xml': xml('workbook'), 'xl/data.xml': xml('A'.repeat(100_000)) });
    const view = new DataView(bytes.buffer);
    let central = 0;
    for (let offset = 0; offset < bytes.length - 46; offset++) if (view.getUint32(offset, true) === 0x02014b50) {
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + view.getUint16(offset + 28, true)));
      if (name === 'xl/data.xml') { central = offset; break; }
    }
    const local = view.getUint32(central + 42, true);
    view.setUint32(central + 24, 1, true); view.setUint32(local + 22, 1, true);
    await expect(assertXlsxArchiveBudget(bytes)).rejects.toThrow('解压预算');
  });
  it('rejects extreme sparse worksheet dimensions before the XLSX decoder allocates rows', async () => {
    const bytes = zipSync({ '[Content_Types].xml': xml('types'), 'xl/workbook.xml': xml('workbook'), 'xl/worksheets/sheet1.xml': xml('<worksheet><sheetData><row r="99999999"><c r="A99999999"/></row></sheetData></worksheet>') });
    await expect(assertXlsxArchiveBudget(bytes)).rejects.toThrow('解压预算');
  });
  it('converts explicit UTC/offset dates and refuses numeric or timezone-less values', () => {
    expect(parseImportedDate('2026-10-14T09:30:00+08:00')).toBe('2026-10-14T01:30:00.000Z');
    expect(parseImportedDate(new Date('2026-10-14T00:00:00Z'))).toBe('2026-10-14T00:00:00.000Z');
    expect(() => parseImportedDate(46000)).toThrow('序列号');
    expect(() => parseImportedDate('2026-10-14T24:00:00Z')).toThrow('时分秒');
  });
});
