import type { CaptureOrigin, DataSnapshot, Language, UUID, VocabularyPayload } from '../../domain';

export type ImportFormat = 'csv' | 'xlsx' | 'txt' | 'json';
export type ExportFormat = 'csv' | 'txt' | 'json';
export type ImportField = 'word' | 'lang' | 'meaning' | 'context' | 'source' | 'created_at' | 'tags';
export type DuplicateChoice = 'skip' | 'fill-empty-fields' | 'keep-separate';
export interface ImportCommitResult { readonly added: number; readonly updated: number; readonly skipped: number }

export interface ImportRowIssue {
  readonly rowNumber: number;
  readonly field?: ImportField;
  readonly message: string;
}

export interface ImportPreview {
  readonly batchId: UUID;
  readonly mode: 'merge-vocabulary';
  readonly format: ImportFormat;
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly duplicateRows: number;
  readonly columns: readonly string[];
  readonly mapping: Partial<Record<ImportField, string>>;
  readonly sheetNames?: readonly string[];
  readonly sheetName?: string;
  readonly rows: readonly {
    readonly rowId: UUID;
    readonly rowNumber: number;
    readonly payload: VocabularyPayload;
    readonly createdAt?: string;
    readonly capturedAt: string;
    readonly origin: CaptureOrigin;
    /** At most 10 existing + 10 earlier input suggestions; commit always rechecks all current data. */
    readonly possibleDuplicateIds: readonly UUID[];
  }[];
  readonly issues: readonly ImportRowIssue[];
}

/** Phase 1 CSV/TXT/XLSX vocabulary merge. Reserved JSON vocabulary extraction is not implemented. */
export interface FileImportPort {
  preview(file: File, options: { readonly defaultLanguage: Language; readonly mapping: Partial<Record<ImportField, string>>; readonly sheetName?: string }): Promise<ImportPreview>;
  commit(preview: ImportPreview, choices: Readonly<Record<UUID, DuplicateChoice>>): Promise<ImportCommitResult>;
}

export interface BackupRestorePreview {
  readonly restoreId: UUID;
  readonly mode: 'restore-backup';
  readonly format: 'json';
  /** Fully validated snapshot, including cards, events, settings and deletion evidence. */
  readonly snapshot: DataSnapshot;
}

export type BackupRestoreMode = 'replace-local' | 'new-local-profile' | 'merge-current';

/** Phase 1 full JSON restore. Confirm after preview; preserve a backup before any local mutation. */
export interface BackupRestorePort {
  preview(file: File): Promise<BackupRestorePreview>;
  restore(preview: BackupRestorePreview, mode: BackupRestoreMode): Promise<{
    readonly restoredSnapshotId: UUID;
    readonly preRestoreBackup: Blob;
  }>;
}

/** JSON is the lossless format; CSV requires formula-injection-safe escaping. */
export interface FileExportPort {
  export(snapshot: DataSnapshot, format: ExportFormat): Promise<Blob>;
}
