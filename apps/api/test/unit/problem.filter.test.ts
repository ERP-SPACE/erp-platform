import { InvalidTransitionError } from "@erp/domain";
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { requestContext } from "../../src/common/context.js";
import { AppError, versionConflict } from "../../src/common/errors.js";
import { ProblemFilter } from "../../src/common/problem.filter.js";

function render(error: unknown) {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => reply }) };
  requestContext.run({ requestId: "req-1" }, () => new ProblemFilter().catch(error, host as never));
  return sent;
}

describe("ProblemFilter", () => {
  it("renders AppError as problem+json with code and request id", () => {
    const sent = render(versionConflict({ version: 3, updatedBy: "u1", updatedAt: "2026-10-23T09:00:00.000Z" }));
    expect(sent.status).toBe(409);
    expect(sent.headers["content-type"]).toBe("application/problem+json");
    expect(sent.body).toMatchObject({ code: "VERSION_CONFLICT", requestId: "req-1", current: { version: 3 } });
  });

  it("maps domain errors", () => {
    expect(render(new InvalidTransitionError("SO", "Closed", "Draft")).body).toMatchObject({
      status: 422,
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("maps Nest HTTP exceptions and hides unknown errors", () => {
    expect(render(new NotFoundException()).body).toMatchObject({ status: 404, code: "NOT_FOUND" });
    const hidden = render(new Error("db password is hunter2"));
    expect(hidden.status).toBe(500);
    expect(JSON.stringify(hidden.body)).not.toContain("hunter2");
  });

  it("keeps custom statuses", () => {
    expect(render(new AppError(429, "RATE_LIMITED", "slow down")).status).toBe(429);
  });
});
