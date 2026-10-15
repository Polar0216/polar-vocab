import Papa from 'papaparse';
import { languageSchema, vocabularyPayloadSchema, type Language, type VocabularyPayload } from '../../domain';
import type { ImportRowIssue } from '../../features/import-export/contracts';
import { IMPORT_LIMITS, ImportError } from '../../features/import-export/limits';

export interface ClipboardTextPreview {
  readonly kind: 'single' | 'batch';
  readonly text: string;
  readonly totalRows: number;
  readonly rows: { rowNumber: number; payload: VocabularyPayload }[];
  readonly issues: ImportRowIssue[];
}

const headerNames: Record<string, string> = {
  word: 'word', lemma: 'word', 单词: 'word', 词形: 'word',
  lang: 'lang', language: 'lang', 语言: 'lang',
  meaning: 'meaning', 释义: 'meaning', 中文释义: 'meaning',
  context: 'context', 原句: 'context', source: 'source', 来源: 'source', tags: 'tags', 标签: 'tags',
};

/** A phrase remains one row. Only newline/Tab boundaries opt into batch collection. */
export function parseClipboardText(value: string, defaultLanguage: Language): ClipboardTextPreview {
  languageSchema.parse(defaultLanguage);
  if (value.length > IMPORT_LIMITS.fileBytes || new TextEncoder().encode(value).length > IMPORT_LIMITS.fileBytes) throw new ImportError('剪贴板文本超过 5 MiB，请分批粘贴。');
  const text = value.trim();
  const kind = /[\r\n\t]/.test(text) ? 'batch' : 'single';
  const rows: ClipboardTextPreview['rows'] = [], issues: ImportRowIssue[] = [];
  if (!text) return { kind, text, totalRows: 0, rows, issues };
  const raw: { cells: string[]; number: number }[] = [];
  if (text.includes('\t')) {
    let line = 1, cursor = 0;
    Papa.parse<string[]>(text, {
      delimiter: '\t', header: false, skipEmptyLines: false,
      step(result, parser) {
        const number = line;
        line += (text.slice(cursor, result.meta.cursor).match(/\r\n|\r|\n/g) ?? []).length;
        cursor = result.meta.cursor;
        if (result.data.some((cell) => cell.trim())) raw.push({ cells: result.data, number });
        for (const error of result.errors) issues.push({ rowNumber: number, message: `Tab 文本格式错误：${error.message}` });
        if (raw.length > IMPORT_LIMITS.rows + 1 || result.data.length > IMPORT_LIMITS.columns) { parser.abort(); throw new ImportError('剪贴板最多 5,000 行、64 列。'); }
      },
    });
  } else {
    text.split(/\r\n|\r|\n/).forEach((line, index) => { if (line.trim()) raw.push({ cells: [line.trim()], number: index + 1 }); });
  }
  const first = raw[0]?.cells.map((cell) => headerNames[cell.trim().toLowerCase()]) ?? [];
  const hasHeader = text.includes('\t') && first.includes('word') && first.every((field) => field !== undefined);
  const data = hasHeader ? raw.slice(1) : raw;
  if (data.length > IMPORT_LIMITS.rows) throw new ImportError('剪贴板最多 5,000 行。');
  for (const row of data) {
    if (issues.some((issue) => issue.rowNumber === row.number)) continue;
    try {
      const fields = hasHeader ? first : ['word', 'lang', 'meaning', 'context', 'source', 'tags'];
      if (row.cells.length > fields.length) throw new ImportError('Tab 列数超过支持字段，请编辑后粘贴。');
      const read = (field: string) => row.cells[fields.indexOf(field)]?.trim() ?? '';
      const lemma = read('word'), lang = languageSchema.parse(read('lang') || defaultLanguage);
      const meaning = read('meaning'), context = read('context'), source = read('source'), tags = read('tags');
      const payload = vocabularyPayloadSchema.parse({
        lemma, lang, ...(meaning ? { meanings: [meaning] } : {}),
        ...(context ? { contexts: [{ id: crypto.randomUUID(), text: context }] } : {}),
        ...(source ? { source } : {}),
        ...(tags ? { tags: tags.split(/[;；|]/).map((tag) => tag.trim()).filter(Boolean) } : {}),
      });
      rows.push({ rowNumber: row.number, payload });
    } catch (error) { issues.push({ rowNumber: row.number, message: error instanceof Error ? error.message : '内容校验失败。' }); }
  }
  return { kind, text, totalRows: data.length, rows, issues };
}
