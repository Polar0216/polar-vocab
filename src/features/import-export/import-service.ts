import Papa from 'papaparse';
import { ZodError } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import { languageSchema, vocabularyPayloadSchema, type Language, type VocabularyPayload } from '../../domain';
import type { LocalVocabularyService } from '../vocabulary/service';
import { normalizeForDuplicate } from '../vocabulary/query';
import type { DuplicateChoice, FileImportPort, ImportCommitResult, ImportField, ImportFormat, ImportPreview, ImportRowIssue } from './contracts';
import { assertFileSize, assertXlsxArchiveBudget, IMPORT_LIMITS, ImportError } from './limits';
import { parseClipboardText } from '../../integrations/clipboard/preview';

export interface ImportTable {
  readonly format: ImportFormat;
  readonly columns: string[];
  readonly rows: unknown[][];
  readonly rowNumbers: number[];
  readonly issues: ImportRowIssue[];
  readonly sheetNames?: string[];
  readonly sheetName?: string;
}

const aliases: Readonly<Record<ImportField, readonly string[]>> = {
  word: ['word', 'lemma', '单词', '词形', '原词', '词汇'], lang: ['lang', 'language', '语言'],
  meaning: ['meaning', 'meanings', '释义', '中文释义', '中文'], context: ['context', '原句', '例句'],
  source: ['source', '来源'], tags: ['tags', 'tag', '标签'], created_at: ['created_at', 'createdat', '创建时间', '日期'],
};

export function inferMapping(columns: readonly string[]): Partial<Record<ImportField, string>> {
  const result: Partial<Record<ImportField, string>> = {};
  for (const field of Object.keys(aliases) as ImportField[]) {
    const column = columns.find((value) => aliases[field].includes(value.trim().toLowerCase()));
    if (column !== undefined) result[field] = column;
  }
  if (!result.word && columns.length) result.word = columns[0];
  return result;
}

/** Offset-aware datetime and date-only are explicit; timezone-less datetimes are rejected. */
export function parseImportedDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new ImportError('日期无效。');
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new ImportError('日期必须是 YYYY-MM-DD、带时区的 ISO 时间或 Excel 日期单元格，不能是序列号。');
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new ImportError('日期无效。');
    return date.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw new ImportError('日期时间必须显式包含 Z 或 +08:00 等时区。');
  if (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || Number(text.slice(17, 19)) > 59) throw new ImportError('日期时间的时分秒无效。');
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new ImportError('日期无效。');
  // Date.parse normalizes impossible calendar dates; validate its calendar prefix independently.
  parseImportedDate(text.slice(0, 10));
  return date.toISOString();
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new ImportError('不支持该单元格类型；公式请先粘贴为值，日期仅可映射到 created_at。');
}

function tableFromRows(format: ImportFormat, rows: unknown[][], rowNumbers: number[], issues: ImportRowIssue[]): ImportTable {
  const nonEmpty = rows.map((row, index) => ({ row, number: rowNumbers[index] })).filter(({ row }) => row.some((value) => value !== null && value !== undefined && String(value).trim() !== ''));
  if (nonEmpty.length > IMPORT_LIMITS.rows + 1 || nonEmpty.some(({ row }) => row.length > IMPORT_LIMITS.columns)) throw new ImportError('最多导入 5,000 行、64 列，请拆分文件。');
  const first = nonEmpty[0]?.row ?? [];
  const hasHeader = first.some((value) => typeof value === 'string' && Object.values(aliases).some((values) => values.includes(value.trim().toLowerCase())));
  const width = Math.max(1, ...nonEmpty.map(({ row }) => row.length));
  const columns = hasHeader ? Array.from({ length: width }, (_, index) => cellText(first[index]) || `列${index + 1}`) : Array.from({ length: width }, (_, index) => `列${index + 1}`);
  if (new Set(columns).size !== columns.length) throw new ImportError('表头存在重复列名，请先重命名再导入。');
  const data = hasHeader ? nonEmpty.slice(1) : nonEmpty;
  if (data.length > IMPORT_LIMITS.rows) throw new ImportError('最多导入 5,000 行，请拆分文件。');
  return { format, columns, rows: data.map(({ row }) => row), rowNumbers: data.map(({ number }) => number), issues };
}

function parseCsv(text: string): ImportTable {
  const input = text.replace(/^\uFEFF/, '');
  const rows: unknown[][] = [], rowNumbers: number[] = [], issues: ImportRowIssue[] = [];
  let previousCursor = 0, physicalLine = 1, exceeded = false;
  Papa.parse<string[]>(input, {
    header: false, dynamicTyping: false, skipEmptyLines: false,
    delimitersToGuess: [',', ';', '\t'],
    step(result, parser) {
      const line = physicalLine;
      const end = result.meta.cursor;
      physicalLine += (input.slice(previousCursor, end).match(/\r\n|\r|\n/g) ?? []).length;
      previousCursor = end;
      rows.push(result.data); rowNumbers.push(line);
      for (const error of result.errors) if (error.code !== 'UndetectableDelimiter') issues.push({ rowNumber: line, message: `CSV 格式错误：${error.message}` });
      if (rows.length > IMPORT_LIMITS.rows + 1 || result.data.length > IMPORT_LIMITS.columns) { exceeded = true; parser.abort(); }
    },
  });
  if (exceeded) throw new ImportError('最多导入 5,000 行、64 列，请拆分文件。');
  return tableFromRows('csv', rows, rowNumbers, issues);
}

function extension(file: File): ImportFormat {
  const value = file.name.split('.').at(-1)?.toLowerCase();
  if (value === 'numbers') throw new ImportError('请先在 Numbers 中导出为 CSV 或 XLSX。');
  if (value !== 'csv' && value !== 'txt' && value !== 'xlsx') throw new ImportError('词汇导入支持 CSV、TXT、XLSX；完整 JSON 请使用备份恢复。');
  const acceptedTypes = ['application/octet-stream', value === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain', ...(value === 'csv' ? ['text/csv', 'application/csv', 'application/vnd.ms-excel'] : []), ...(value === 'xlsx' ? ['application/zip'] : [])];
  if (file.type && !acceptedTypes.includes(file.type.toLowerCase().split(';')[0])) throw new ImportError('文件类型与扩展名不符，请重新导出 CSV、TXT 或 XLSX。');
  return value;
}

const duplicateKey = (payload: VocabularyPayload) => `${payload.lang}:${normalizeForDuplicate(payload.lemma, payload.lang)}`;
function duplicateIndex(entries: readonly VocabularyPayload[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const key = duplicateKey(entry);
    const indexes = result.get(key) ?? [];
    indexes.push(index); result.set(key, indexes);
  });
  return result;
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new ImportError('无法读取本地文件。'));
    reader.readAsArrayBuffer(file);
  });
}

async function readFileText(file: File): Promise<string> {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(await readFileBytes(file)); }
  catch (error) { if (error instanceof ImportError) throw error; throw new ImportError('文本文件必须为有效 UTF-8，请在 Numbers/Excel 中重新导出。'); }
}

export class LocalFileImportService implements FileImportPort {
  private readonly batches = new WeakMap<File, { id: string; capturedAt: string }>();
  private readonly workbooks = new WeakMap<File, { sheet: string; data: unknown[][] }[]>();
  private readonly vocabularyService: Pick<LocalVocabularyService, 'list' | 'commitImport'>;
  constructor(vocabularyService: Pick<LocalVocabularyService, 'list' | 'commitImport'>) { this.vocabularyService = vocabularyService; }

  async readTable(file: File, sheetName?: string): Promise<ImportTable> {
    assertFileSize(file);
    const format = extension(file);
    if (format === 'csv') return parseCsv(await readFileText(file));
    if (format === 'txt') {
      const lines = (await readFileText(file)).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
      if (lines.length > IMPORT_LIMITS.rows + 1) throw new ImportError('最多导入 5,000 行，请拆分文件。');
      const rows = lines.map((text, index) => ({ text: text.trim(), number: index + 1 })).filter(({ text }) => text);
      return { format, columns: ['word'], rows: rows.map(({ text }) => [text]), rowNumbers: rows.map(({ number }) => number), issues: [] };
    }
    let workbook = this.workbooks.get(file);
    if (!workbook) {
      const buffer = await readFileBytes(file);
      await assertXlsxArchiveBudget(new Uint8Array(buffer));
      // Public universal entry parses locally without blob workers or Node adapters.
      // Kept out of the initial bundle; no fetch or external runtime dependencies.
      const module = await import('read-excel-file/universal');
      try { workbook = await module.default(buffer, { trim: false }); }
      catch { throw new ImportError('无法解析 XLSX；请检查文件是否损坏或重新导出。'); }
      this.workbooks.set(file, workbook);
    }
    const sheetNames = workbook.map((sheet) => sheet.sheet);
    const sheet = sheetName ? workbook.find((sheet) => sheet.sheet === sheetName) : workbook[0];
    if (!sheet) throw new ImportError('找不到所选工作表。');
    if (sheet.data.length > IMPORT_LIMITS.rows + 1 || sheet.data.some((row) => row.length > IMPORT_LIMITS.columns)) throw new ImportError('所选工作表超过 5,000 行或64列，请拆分文件。');
    return { ...tableFromRows('xlsx', sheet.data, sheet.data.map((_, index) => index + 1), []), sheetNames, sheetName: sheet.sheet };
  }

  async preview(file: File, options: { defaultLanguage: Language; mapping: Partial<Record<ImportField, string>>; sheetName?: string }): Promise<ImportPreview> {
    languageSchema.parse(options.defaultLanguage);
    const table = await this.readTable(file, options.sheetName);
    const mapping = { ...inferMapping(table.columns), ...options.mapping };
    if (!mapping.word) throw new ImportError('请映射必填的 word 列。');
    for (const column of Object.values(mapping)) if (column && !table.columns.includes(column)) throw new ImportError(`映射列不存在：${column}`);
    const batch = this.batches.get(file) ?? { id: crypto.randomUUID(), capturedAt: new Date().toISOString() };
    this.batches.set(file, batch);
    const issues = [...table.issues];
    const rows: ImportPreview['rows'][number][] = [];
    const existing = await this.vocabularyService.list();
    const existingByKey = duplicateIndex(existing);
    const fileByKey = new Map<string, string[]>();
    for (let index = 0; index < table.rows.length; index++) {
      const rowNumber = table.rowNumbers[index], rowId = uuidv5(`row:${table.sheetName ?? ''}:${rowNumber}`, batch.id);
      if (table.issues.some((issue) => issue.rowNumber === rowNumber)) continue;
      const values = table.rows[index];
      let field: ImportField = 'word';
      const read = (name: ImportField) => { field = name; return mapping[name] ? values[table.columns.indexOf(mapping[name]!)] : undefined; };
      try {
        const lemma = cellText(read('word'));
        const langValue = cellText(read('lang')) || options.defaultLanguage;
        const lang = languageSchema.parse(langValue);
        const meaning = cellText(read('meaning')), context = cellText(read('context')), source = cellText(read('source')), tags = cellText(read('tags'));
        const createdAt = parseImportedDate(read('created_at'));
        const payload: VocabularyPayload = vocabularyPayloadSchema.parse({
          lemma, lang, ...(meaning ? { meanings: [meaning] } : {}),
          ...(context ? { contexts: [{ id: uuidv5('context:0', rowId), text: context }] } : {}),
          ...(source ? { source } : {}),
          ...(tags ? { tags: tags.split(/[;；|]/).map((tag) => tag.trim()).filter(Boolean) } : {}),
        });
        const key = duplicateKey(payload), inFile = fileByKey.get(key) ?? [];
        // Cap UI suggestions to avoid quadratic memory for 5,000 copies of the same word.
        const possibleDuplicateIds = [...(existingByKey.get(key) ?? []).slice(0, 10).map((item) => existing[item].id), ...inFile.slice(0, 10)];
        rows.push({ rowId, rowNumber, payload, createdAt, capturedAt: batch.capturedAt, origin: table.format === 'csv' ? 'ios-csv' : 'manual', possibleDuplicateIds });
        inFile.push(rowId); fileByKey.set(key, inFile);
      } catch (error) {
        if (error instanceof ZodError) {
          const path = String(error.issues[0]?.path[0] ?? '');
          field = ({ lemma: 'word', lang: 'lang', meanings: 'meaning', contexts: 'context', source: 'source', tags: 'tags' } as Partial<Record<string, ImportField>>)[path] ?? field;
        }
        issues.push({ rowNumber, field, message: error instanceof ImportError ? error.message : error instanceof Error ? error.message : '字段校验失败。' });
      }
    }
    return {
      batchId: batch.id, mode: 'merge-vocabulary', format: table.format,
      columns: table.columns, mapping, sheetNames: table.sheetNames, sheetName: table.sheetName,
      totalRows: table.rows.length, validRows: rows.length, invalidRows: table.rows.length - rows.length,
      duplicateRows: rows.filter((row) => row.possibleDuplicateIds.length).length, rows, issues,
    };
  }

  async previewClipboard(text: string, defaultLanguage: Language): Promise<ImportPreview> {
    const parsed = parseClipboardText(text, defaultLanguage);
    const batchId = crypto.randomUUID(), capturedAt = new Date().toISOString();
    const existing = await this.vocabularyService.list();
    const existingByKey = duplicateIndex(existing), fileByKey = new Map<string, string[]>();
    const rows: ImportPreview['rows'][number][] = [];
    for (const row of parsed.rows) {
      const rowId = uuidv5(`row:${row.rowNumber}`, batchId);
      const key = duplicateKey(row.payload), inFile = fileByKey.get(key) ?? [];
      rows.push({ rowId, rowNumber: row.rowNumber, payload: row.payload, capturedAt, origin: 'clipboard', possibleDuplicateIds: [...(existingByKey.get(key) ?? []).slice(0, 10).map((item) => existing[item].id), ...inFile.slice(0, 10)] });
      inFile.push(rowId); fileByKey.set(key, inFile);
    }
    return { batchId, mode: 'merge-vocabulary', format: 'txt', columns: ['word', 'lang', 'meaning'], mapping: {}, totalRows: parsed.totalRows, validRows: rows.length, invalidRows: parsed.totalRows - rows.length, duplicateRows: rows.filter((row) => row.possibleDuplicateIds.length).length, rows, issues: parsed.issues };
  }

  async commit(preview: ImportPreview, choices: Readonly<Record<string, DuplicateChoice>>): Promise<ImportCommitResult> {
    return this.vocabularyService.commitImport(preview, choices);
  }
}
