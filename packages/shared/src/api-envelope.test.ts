import { describe, expect, it } from "vitest";
import { ok, err, envelope, isOk, isErr } from "@statehub/shared";

describe("api envelope smoke test", () => {
  it("ok() wraps payload in a success envelope", () => {
    const result = ok({ x: 1 });
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.data.x).toBe(1);
  });

  it("err() builds an error envelope with canonical code", () => {
    const result = err("not_found", "resource missing", {
      next_action: "check the URL",
    });
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("not_found");
    expect(result.message).toBe("resource missing");
    expect(result.retryable).toBe(false);
    expect(result.next_action).toBe("check the URL");
  });

  it("err() marks retryable codes as retryable", () => {
    const result = err("rate_limited", "slow down");
    expect(result.retryable).toBe(true);
  });

  it("envelope() passes through ApiError values", () => {
    const result = envelope(() => err("conflict", "dup"));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error_code).toBe("conflict");
      expect(result.message).toBe("dup");
    }
  });

  it("envelope() wraps thrown errors as internal_error", () => {
    const result = envelope(() => {
      throw new Error("boom");
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error_code).toBe("internal_error");
      expect(result.message).toBe("boom");
    }
  });

  it("envelope() converts null to not_found (no silent null success)", () => {
    const result = envelope(() => null);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error_code).toBe("not_found");
      expect(result.retryable).toBe(false);
    }
  });

  it("envelope() converts undefined to not_found", () => {
    const result = envelope(() => undefined);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error_code).toBe("not_found");
    }
  });

  it("envelope() wraps truthy values as success", () => {
    const result = envelope(() => ({ id: "wi_1", title: "build it" }));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.id).toBe("wi_1");
    }
  });
});
