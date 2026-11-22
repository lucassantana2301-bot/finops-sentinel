export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  /** Atraso base do backoff exponencial, em ms. */
  baseDelayMs?: number;
  /** Teto de espera aceito do Retry-After, em ms (APIs de custo do Azure pedem até 60 s). */
  maxDelayMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response): number | null {
  const header =
    response.headers.get('retry-after') ??
    response.headers.get('x-ms-ratelimit-microsoft.costmanagement-entity-retry-after') ??
    response.headers.get('x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * fetch com timeout, retry em erros transitórios (429/5xx/rede) e respeito ao Retry-After.
 * Erros 4xx que não são transitórios falham na hora: repetir um 401 só gera bloqueio.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const baseDelay = options.baseDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 60_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      const body = await response.text().catch(() => '');
      const error = new HttpError(`HTTP ${response.status}`, response.status, body.slice(0, 500));
      if (!RETRYABLE.has(response.status) || attempt === retries) throw error;
      lastError = error;
      const wait = retryAfterMs(response) ?? baseDelay * 2 ** attempt;
      await sleep(Math.min(wait, maxDelay));
    } catch (error) {
      if (error instanceof HttpError && (!RETRYABLE.has(error.status) || attempt === retries)) throw error;
      if (!(error instanceof HttpError) && attempt === retries) throw error;
      lastError = error;
      if (!(error instanceof HttpError)) await sleep(Math.min(baseDelay * 2 ** attempt, maxDelay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('falha de rede');
}
