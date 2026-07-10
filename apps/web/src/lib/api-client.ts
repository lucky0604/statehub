/**
 * Client-side API fetcher. Wraps fetch with the envelope contract.
 *
 * Every call goes through the /api routes — the UI never touches the DB
 * directly. This keeps the trust boundary clean: all mutations pass through
 * the API envelope, event emission, and workspace enforcement.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error_code: string; message: string; retryable?: boolean };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiResult<T>;
  if (!json.ok) {
    throw new ApiError(json.error_code, json.message, res.status);
  }
  return json.data;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
