/**
 * Provider error taxonomy — used by all provider clients.
 *
 * The fetch API route catches these and maps them to a structured
 * error envelope (see docs/github-live-fetch.md).
 */

export class ProviderError extends Error {
  readonly provider: string;
  readonly code: string;

  constructor(message: string, provider: string, code: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
  }
}

export class AuthError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, provider, "provider_auth_failed");
    this.name = "AuthError";
  }
}

export class RateLimitError extends ProviderError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, provider: string, retryAfterSeconds?: number) {
    super(message, provider, "provider_rate_limited");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderNotFoundError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, provider, "provider_not_found");
    this.name = "ProviderNotFoundError";
  }
}

export class ProviderUnreachableError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, provider, "provider_unreachable");
    this.name = "ProviderUnreachableError";
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}
