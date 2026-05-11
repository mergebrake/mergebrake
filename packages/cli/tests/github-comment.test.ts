import { describe, expect, it, vi } from "vitest";
import {
  buildCommentBody,
  postStickyComment,
  resolvePrNumber,
  DEFAULT_STICKY_MARKER,
  type IssueComment,
} from "../src/github-comment.js";
import type { AnalysisReport } from "mergebrake-shared";

const baseReport: AnalysisReport = {
  verdict: "BLOCK",
  riskScore: 150,
  findings: [],
  aiPrSignals: {
    hasCoAuthoredByAi: false,
    coAuthors: [],
    isLikelyAiGenerated: false,
    reasons: [],
    scrutinyMultiplier: 1,
  },
  ormStack: "prisma",
  dialect: "postgres",
  scannedFiles: ["prisma/migrations/x/migration.sql"],
  durationMs: 12,
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function fakeFetchSequence(handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>): typeof fetch {
  let i = 0;
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = handlers[i++];
    if (!handler) throw new Error(`Unexpected extra fetch call: ${url}`);
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe("buildCommentBody", () => {
  it("prepends the marker on the first line", () => {
    const body = buildCommentBody("hello", "mergebrake:test");
    expect(body.startsWith("<!-- mergebrake:test -->\n")).toBe(true);
    expect(body.includes("hello")).toBe(true);
  });

  it("trims trailing whitespace but ends with newline", () => {
    const body = buildCommentBody("hello\n\n\n", "m");
    expect(body.endsWith("hello\n")).toBe(true);
  });
});

describe("postStickyComment", () => {
  it("creates a new comment when no marker is found", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fakeFetch = fakeFetchSequence([
      (url) => {
        calls.push({ url, method: "GET" });
        return jsonResponse([] satisfies IssueComment[]);
      },
      (url, init) => {
        calls.push({
          url,
          method: String(init?.method ?? "GET"),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return jsonResponse({ id: 7, html_url: "https://example/c/7" });
      },
    ]);

    const res = await postStickyComment({
      report: baseReport,
      token: "tok",
      repo: "octo/repo",
      prNumber: 42,
      fetchFn: fakeFetch,
      render: () => "rendered body",
    });

    expect(res.action).toBe("created");
    expect(res.commentId).toBe(7);
    expect(res.htmlUrl).toBe("https://example/c/7");
    expect(res.body.startsWith(`<!-- ${DEFAULT_STICKY_MARKER} -->`)).toBe(true);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toMatch(/\/repos\/octo\/repo\/issues\/42\/comments\?per_page=100&page=1$/);
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toMatch(/\/repos\/octo\/repo\/issues\/42\/comments$/);
    const posted = JSON.parse(calls[1]!.body!);
    expect(posted.body).toContain("rendered body");
    expect(posted.body).toContain(`<!-- ${DEFAULT_STICKY_MARKER} -->`);
  });

  it("updates the existing comment when the marker is found", async () => {
    const existing: IssueComment[] = [
      { id: 1, body: "unrelated comment" },
      {
        id: 99,
        body: `<!-- ${DEFAULT_STICKY_MARKER} -->\nold body`,
        html_url: "https://example/c/99",
      },
    ];
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fakeFetch = fakeFetchSequence([
      (url) => {
        calls.push({ url, method: "GET" });
        return jsonResponse(existing);
      },
      (url, init) => {
        calls.push({
          url,
          method: String(init?.method ?? "GET"),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return jsonResponse({ id: 99, html_url: "https://example/c/99" });
      },
    ]);

    const res = await postStickyComment({
      report: baseReport,
      token: "tok",
      repo: "octo/repo",
      prNumber: 7,
      fetchFn: fakeFetch,
      render: () => "fresh body",
    });

    expect(res.action).toBe("updated");
    expect(res.commentId).toBe(99);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.method).toBe("PATCH");
    expect(calls[1]!.url).toMatch(/\/repos\/octo\/repo\/issues\/comments\/99$/);
    const patched = JSON.parse(calls[1]!.body!);
    expect(patched.body).toContain("fresh body");
  });

  it("respects a custom marker", async () => {
    const existing: IssueComment[] = [
      { id: 50, body: `<!-- other-marker -->\nbody` },
    ];
    const calls: Array<{ url: string; method: string }> = [];
    const fakeFetch = fakeFetchSequence([
      (url) => {
        calls.push({ url, method: "GET" });
        return jsonResponse(existing);
      },
      (url, init) => {
        calls.push({ url, method: String(init?.method) });
        return jsonResponse({ id: 51 });
      },
    ]);

    const res = await postStickyComment({
      report: baseReport,
      token: "tok",
      repo: "o/r",
      prNumber: 1,
      marker: "mergebrake:second",
      fetchFn: fakeFetch,
      render: () => "second pass",
    });

    expect(res.action).toBe("created");
    expect(calls[1]!.method).toBe("POST");
  });

  it("throws when the API call fails", async () => {
    const fakeFetch = fakeFetchSequence([
      () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        }),
    ]);
    await expect(
      postStickyComment({
        report: baseReport,
        token: "tok",
        repo: "o/r",
        prNumber: 5,
        fetchFn: fakeFetch,
      }),
    ).rejects.toThrow(/429/);
  });

  it("rejects bad input early", async () => {
    await expect(
      postStickyComment({
        report: baseReport,
        token: "",
        repo: "o/r",
        prNumber: 1,
      }),
    ).rejects.toThrow(/missing GitHub token/);

    await expect(
      postStickyComment({
        report: baseReport,
        token: "x",
        repo: "no-slash",
        prNumber: 1,
      }),
    ).rejects.toThrow(/invalid repo slug/);

    await expect(
      postStickyComment({
        report: baseReport,
        token: "x",
        repo: "o/r",
        prNumber: -3,
      }),
    ).rejects.toThrow(/invalid PR number/);
  });
});

describe("resolvePrNumber", () => {
  it("honors explicit numeric arg", async () => {
    const n = await resolvePrNumber({ explicit: "123" });
    expect(n).toBe(123);
  });

  it("ignores non-numeric explicit and falls through", async () => {
    const n = await resolvePrNumber({
      explicit: "",
      ref: "refs/pull/55/merge",
    });
    expect(n).toBe(55);
  });

  it("reads PR number from event payload", async () => {
    const readFile = vi.fn(async () =>
      JSON.stringify({ pull_request: { number: 999 } }),
    );
    const n = await resolvePrNumber({
      eventPath: "/tmp/event.json",
      readFile,
    });
    expect(n).toBe(999);
    expect(readFile).toHaveBeenCalledWith("/tmp/event.json");
  });

  it("falls back to issue.number", async () => {
    const readFile = async () => JSON.stringify({ issue: { number: 17 } });
    const n = await resolvePrNumber({
      eventPath: "/tmp/event.json",
      readFile,
    });
    expect(n).toBe(17);
  });

  it("returns null when nothing is resolvable", async () => {
    const n = await resolvePrNumber({});
    expect(n).toBeNull();
  });
});
