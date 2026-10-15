import Papa from 'papaparse';
import type { Language, VocabularyEntry } from '../../domain';

/** Escape leading control/whitespace plus spreadsheet formula prefixes; JSON remains lossless. */
export function escapeSpreadsheetCell(value: string): string {
  let offset = 0;
  while (offset < value.length && (value.charCodeAt(offset) <= 31 || /\s/u.test(value[offset]))) offset++;
  const formula = offset < value.length && '=+-@'.includes(value[offset]);
  return formula || ['\t', '\r', '\n'].includes(value[0]) ? `'${value}` : value;
}

export function exportVocabularyCsv(entries: readonly VocabularyEntry[], options: { language?: Language } = {}): Blob {
  const fields = ['word', 'lang', 'meaning', 'context', 'source', 'tags', 'created_at'];
  const data = entries.filter((entry) => !entry.deletedAt && (!options.language || entry.lang === options.language)).map((entry) => [
    entry.lemma, entry.lang, (entry.meanings ?? []).join('；'), (entry.contexts ?? []).map((context) => context.text).join('\n'),
    entry.source ?? (entry.contexts ?? []).map((context) => context.source).filter(Boolean).join('\n'),
    (entry.tags ?? []).join(';'), entry.createdAt,
  ].map(escapeSpreadsheetCell));
  const csv = Papa.unparse({ fields, data }, { newline: '\r\n', quotes: true });
  return new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
}

/** UI may pass its current filtered array; this helper never fetches or mutates records. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
