/** Files remain bounded even when compressed ZIP metadata is forged. */
export const IMPORT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  rows: 5_000,
  columns: 64,
  xlsxEntries: 256,
  xlsxExpandedBytes: 20 * 1024 * 1024,
  xlsxEntryBytes: 10 * 1024 * 1024,
  inflateInputChunk: 1_024,
} as const;

export class ImportError extends Error {
  constructor(message: string) { super(message); this.name = 'ImportError'; }
}

export function assertFileSize(file: Pick<File, 'size'>): void {
  if (file.size > IMPORT_LIMITS.fileBytes) throw new ImportError('文件超过 5 MiB，请拆分后导入。');
  if (file.size === 0) throw new ImportError('文件为空。');
}

/** Strict ZIP32 central-directory preflight, followed by bounded streaming inflation. */
export async function assertXlsxArchiveBudget(bytes: Uint8Array): Promise<void> {
  const { Inflate } = await import('fflate');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const fail = () => { throw new ImportError('XLSX 压缩结构异常、加密或超过解压预算。'); };
  if (bytes.length < 22 || bytes.length > IMPORT_LIMITS.fileBytes) fail();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail();
  const count = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || count !== u16(end + 8) || count < 1 || count > IMPORT_LIMITS.xlsxEntries || directoryOffset + directorySize !== end) fail();
  let cursor = directoryOffset, declaredTotal = 0, actualTotal = 0;
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) fail();
    const flags = u16(cursor + 8), method = u16(cursor + 10), compressed = u32(cursor + 20), expanded = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32), local = u32(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || flags & 0x40 || method !== 0 && method !== 8 || u16(cursor + 34) || local === 0xffffffff || compressed === 0xffffffff || expanded > IMPORT_LIMITS.xlsxEntryBytes) fail();
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = new TextDecoder().decode(nameBytes);
    if (!name || name.includes('\\') || name.startsWith('/') || name.includes('\0') || name.split('/').includes('..') || names.has(name)) fail();
    names.add(name);
    // ZIP64 is intentionally unsupported, including a ZIP64 extra field with small sentinel-free sizes.
    let extra = cursor + 46 + nameLength;
    while (extra < cursor + 46 + nameLength + extraLength) {
      if (extra + 4 > cursor + 46 + nameLength + extraLength || u16(extra) === 1) fail();
      extra += 4 + u16(extra + 2);
    }
    if (extra !== cursor + 46 + nameLength + extraLength) fail();
    declaredTotal += expanded;
    if (declaredTotal > IMPORT_LIMITS.xlsxExpandedBytes || local + 30 > directoryOffset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail();
    const localNameLength = u16(local + 26), localExtraLength = u16(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength || dataStart + compressed > directoryOffset || !nameBytes.every((value, index) => bytes[local + 30 + index] === value)) fail();
    if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== expanded)) fail();
    ranges.push([local, dataStart + compressed]);
    let actualEntry = 0;
    const worksheetParts: Uint8Array[] = [];
    const isWorksheet = /^xl\/worksheets\/[^/]+\.xml$/.test(name);
    const accept = (chunk: Uint8Array) => {
      actualEntry += chunk.length; actualTotal += chunk.length;
      if (actualEntry > expanded || actualEntry > IMPORT_LIMITS.xlsxEntryBytes || actualTotal > IMPORT_LIMITS.xlsxExpandedBytes) fail();
      if (isWorksheet) worksheetParts.push(chunk.slice());
    };
    if (method === 0) accept(bytes.subarray(dataStart, dataStart + compressed));
    else {
      const inflater = new Inflate((chunk) => accept(chunk));
      try {
        if (compressed === 0) inflater.push(new Uint8Array(), true);
        for (let offset = 0; offset < compressed; offset += IMPORT_LIMITS.inflateInputChunk) {
          const length = Math.min(IMPORT_LIMITS.inflateInputChunk, compressed - offset);
          inflater.push(bytes.subarray(dataStart + offset, dataStart + offset + length), offset + length === compressed);
        }
      } catch (error) { if (error instanceof ImportError) throw error; fail(); }
    }
    if (actualEntry !== expanded) fail();
    if (isWorksheet) {
      const decoder = new TextDecoder();
      const xml = worksheetParts.map((part) => decoder.decode(part, { stream: true })).join('') + decoder.decode();
      if ((xml.match(/<(?:\w+:)?row\b/g) ?? []).length > IMPORT_LIMITS.rows + 1) fail();
      // Avoid huge sparse-array allocations from small XML with extreme coordinates.
      for (const match of xml.matchAll(/\br\s*=\s*["']([A-Za-z]*)(\d+)["']/g)) {
        const row = Number(match[2]);
        let column = 0;
        for (const letter of match[1].toUpperCase()) { column = column * 26 + letter.charCodeAt(0) - 64; if (column > IMPORT_LIMITS.columns) fail(); }
        if (row < 1 || row > IMPORT_LIMITS.rows + 1) fail();
      }
      for (const match of xml.matchAll(/\bref\s*=\s*["'][A-Za-z]+\d+:([A-Za-z]+)(\d+)["']/g)) {
        let column = 0;
        for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
        if (column > IMPORT_LIMITS.columns || Number(match[2]) > IMPORT_LIMITS.rows + 1) fail();
      }
    }
    cursor = next;
  }
  if (cursor !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) fail();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail();
}
