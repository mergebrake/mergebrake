import type { AnalysisReport } from "@mergebrake/shared";
import { renderMarkdown } from "./renderers.js";

/**
 * Default hidden marker used to identify a MergeBrake sticky comment in a PR
 * thread. We keep a separate marker for every report type so users can run
 * MergeBrake in several modes against the same PR without comments stomping
 * on each other.
 */
export const DEFAULT_STICKY_MARKER = "mergebrake:sticky-comment";

export interface PostStickyCommentInput {
  /** The analysis report rendered into the comment body. */
  report: AnalysisReport;
  /** GitHub access token (e.g. `${{ secrets.GITHUB_TOKEN }}`). */
  token: string;
  /** `owner/repo` slug. */
  repo: string;
  /** Pull request (or issue) number. */
  prNumber: number;
  /** Override the hidden marker, e.g. when running MergeBrake twice in one PR. */
  marker?: string;
  /** Override the GitHub API host (used in tests, GitHub Enterprise, etc.). */
  apiBase?: string;
  /** Override the fetch implementation (used in tests). */
  fetchFn?: typeof fetch;
  /** Override the renderer (used in tests / advanced setups). */
  render?: (report: AnalysisReport) => string;
}

export type PostStickyCommentAction = "created" | "updated" | "skipped";

export interface PostStickyCommentResult {
  action: PostStickyCommentAction;
  /** GitHub comment ID after the operation, when available. */
  commentId?: number;
  /** Human-readable HTML URL of the comment, when available. */
  htmlUrl?: string;
  /** The body that was posted (or would have been posted). */
  body: string;
}

export interface IssueComment {
  id: number;
  body?: string | null;
  user?: { login?: string | null; type?: string | null } | null;
  html_url?: string;
}

/**
 * Create or update a MergeBrake sticky comment on a PR.
 *
 * The first matching comment (one containing the hidden marker) is updated in
 * place. If no comment matches, a new one is created. Either way the body is
 * prefixed with an HTML comment that future calls use to locate it again.
 */
export async function postStickyComment(
  input: PostStickyCommentInput,
): Promise<PostStickyCommentResult> {
  const marker = input.marker ?? DEFAULT_STICKY_MARKER;
  const apiBase = (input.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const fetchFn = input.fetchFn ?? fetch;
  const render = input.render ?? renderMarkdown;

  if (!input.token) throw new Error("postStickyComment: missing GitHub token");
  if (!/^[^/\s]+\/[^/\s]+$/.test(input.repo)) {
    throw new Error(
      `postStickyComment: invalid repo slug "${input.repo}" (expected "owner/repo")`,
    );
  }
  if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
    throw new Error(
      `postStickyComment: invalid PR number "${input.prNumber}"`,
    );
  }

  const body = buildCommentBody(render(input.report), marker);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${input.token}`,
    "User-Agent": "mergebrake-cli",
    "Content-Type": "application/json",
  };

  const existing = await findExistingComment({
    apiBase,
    headers,
    repo: input.repo,
    prNumber: input.prNumber,
    marker,
    fetchFn,
  });

  if (existing) {
    const url = `${apiBase}/repos/${input.repo}/issues/comments/${existing.id}`;
    const res = await fetchFn(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(
        `postStickyComment: PATCH ${url} failed with ${res.status} ${res.statusText}: ${text}`,
      );
    }
    const json = (await res.json()) as IssueComment;
    return {
      action: "updated",
      commentId: json.id ?? existing.id,
      ...(json.html_url ? { htmlUrl: json.html_url } : {}),
      body,
    };
  }

  const url = `${apiBase}/repos/${input.repo}/issues/${input.prNumber}/comments`;
  const res = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(
      `postStickyComment: POST ${url} failed with ${res.status} ${res.statusText}: ${text}`,
    );
  }
  const json = (await res.json()) as IssueComment;
  return {
    action: "created",
    ...(typeof json.id === "number" ? { commentId: json.id } : {}),
    ...(json.html_url ? { htmlUrl: json.html_url } : {}),
    body,
  };
}

/**
 * Build the sticky comment body. Includes a hidden marker on the first line
 * so subsequent runs can detect and update it.
 */
export function buildCommentBody(markdown: string, marker: string): string {
  const trimmed = markdown.trimEnd();
  return `<!-- ${marker} -->\n${trimmed}\n`;
}

interface FindExistingInput {
  apiBase: string;
  headers: Record<string, string>;
  repo: string;
  prNumber: number;
  marker: string;
  fetchFn: typeof fetch;
}

async function findExistingComment(
  input: FindExistingInput,
): Promise<IssueComment | null> {
  const markerToken = `<!-- ${input.marker} -->`;
  const perPage = 100;
  for (let page = 1; page <= 10; page++) {
    const url = `${input.apiBase}/repos/${input.repo}/issues/${input.prNumber}/comments?per_page=${perPage}&page=${page}`;
    const res = await input.fetchFn(url, { headers: input.headers });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(
        `postStickyComment: GET ${url} failed with ${res.status} ${res.statusText}: ${text}`,
      );
    }
    const body = (await res.json()) as IssueComment[];
    for (const c of body) {
      if (typeof c.body === "string" && c.body.includes(markerToken)) {
        return c;
      }
    }
    if (body.length < perPage) break;
  }
  return null;
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Resolve the PR number from CLI options or GitHub Actions event payload.
 * Returns `null` if nothing can be inferred so the caller can fail loudly.
 */
export async function resolvePrNumber(opts: {
  explicit?: string | number;
  eventPath?: string;
  ref?: string;
  readFile?: (p: string) => Promise<string>;
}): Promise<number | null> {
  if (opts.explicit !== undefined && opts.explicit !== null && opts.explicit !== "") {
    const n = Number(opts.explicit);
    if (Number.isInteger(n) && n > 0) return n;
  }

  if (opts.eventPath && opts.readFile) {
    try {
      const content = await opts.readFile(opts.eventPath);
      const parsed = JSON.parse(content) as {
        pull_request?: { number?: number };
        issue?: { number?: number };
        number?: number;
      };
      const fromPr = parsed.pull_request?.number;
      if (Number.isInteger(fromPr) && (fromPr as number) > 0) return fromPr as number;
      const fromIssue = parsed.issue?.number;
      if (Number.isInteger(fromIssue) && (fromIssue as number) > 0) return fromIssue as number;
      const fromNumber = parsed.number;
      if (Number.isInteger(fromNumber) && (fromNumber as number) > 0) return fromNumber as number;
    } catch {
      // fallthrough to ref-based inference
    }
  }

  if (opts.ref) {
    const m = /^refs\/pull\/(\d+)\//.exec(opts.ref);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }

  return null;
}
