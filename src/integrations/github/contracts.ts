/** Original transport proposal. Executable Phase 3 transport is GitHubTransport in client.ts. */
export interface GitHubRepositoryTarget {
  readonly owner: string;
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
}

export interface GitHubContentsFile {
  readonly contentUtf8: string;
  /** File blob SHA, never the commit SHA or HTTP ETag. */
  readonly blobSha: string;
  readonly path: string;
}

export type GitHubFailureCode =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found-or-inaccessible'
  | 'sha-conflict'
  | 'validation'
  | 'rate-limited'
  | 'server'
  | 'unknown';

export interface GitHubFailure {
  readonly code: GitHubFailureCode;
  readonly httpStatus?: number;
  /** Sanitized diagnostic. Must not contain request headers, credentials or private payloads. */
  readonly message: string;
  readonly retryAfterSeconds?: number;
  readonly rateLimitResetAt?: string;
  /** A failed transport may have committed a PUT; retry must begin with GET. */
  readonly writeOutcomeUncertain: boolean;
}

export type GitHubContentsResult =
  | { readonly ok: true; readonly file: GitHubContentsFile }
  | { readonly ok: false; readonly error: GitHubFailure };

export interface GitHubContentsWrite {
  readonly target: GitHubRepositoryTarget;
  readonly contentUtf8: string;
  readonly commitMessage: string;
  /** null is reserved for separately confirmed first-file creation, never a 404 fallback. */
  readonly expectedBlobSha: string | null;
}

/** Implementations must hold a session token in memory and exclude API requests from SW caches. */
export interface GitHubContentsPort {
  get(target: GitHubRepositoryTarget): Promise<GitHubContentsResult>;
  put(request: GitHubContentsWrite): Promise<GitHubContentsResult>;
}
