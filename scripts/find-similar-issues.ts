import { OpenRouter } from "@openrouter/sdk";
import {
  buildDuplicateComment,
  parseMaxMatches,
  parseThreshold,
  selectMatches,
  similarityQuestions,
  readSimilarityScores,
  type IssueCandidate,
} from "./issue-similarity.js";

const { OPENROUTER_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER, ISSUE_AUTHOR } = process.env;
const currentNumber = Number(ISSUE_NUMBER);
const threshold = parseThreshold(process.env.ISSUE_SIMILARITY_THRESHOLD);
const maximum = parseMaxMatches(process.env.ISSUE_SIMILARITY_MAX_MATCHES);

if (!OPENROUTER_API_KEY || !GITHUB_TOKEN || !GITHUB_REPOSITORY || !ISSUE_AUTHOR || !Number.isInteger(currentNumber)) {
  throw new Error("Missing required OpenRouter or GitHub Actions environment variables.");
}

const [owner, repo] = GITHUB_REPOSITORY.split("/");
if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be in owner/repo format.");

const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function githubRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) {
    throw new Error(`GitHub API ${options.method || "GET"} failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function listAllIssues(): Promise<IssueCandidate[]> {
  const issues: IssueCandidate[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest<Array<IssueCandidate & { pull_request?: unknown }>>(
      `${api}/issues?state=all&per_page=100&page=${page}`,
    );
    issues.push(...batch.filter((issue) => !issue.pull_request && issue.number !== currentNumber));
    if (batch.length < 100) return issues;
  }
}

async function scoreCandidates(candidates: IssueCandidate[]): Promise<Map<number, number>> {
  const client = new OpenRouter({ apiKey: OPENROUTER_API_KEY! });
  const scores = new Map<number, number>();

  for (let offset = 0; offset < candidates.length; offset += 10) {
    const batch = candidates.slice(offset, offset + 10);
    const questions = similarityQuestions(batch);
    const state = {
      newIssue: { title: process.env.ISSUE_TITLE || "", body: process.env.ISSUE_BODY || "" },
      candidates: batch.map(({ number, title, body, state: issueState }) => ({
        number,
        title,
        body: (body || "").slice(0, 5000),
        state: issueState,
      })),
    };
    const response = await client.alpha.decisions.create({
      decisionsRequest: {
        model: process.env.OPENROUTER_MODEL || "~typesafe/jev-latest",
        sessionId: `github-issue-similarity-${GITHUB_REPOSITORY}-${currentNumber}-${offset}`,
        state,
        questions,
      },
    });

    for (const [number, score] of readSimilarityScores(batch, response.answers)) scores.set(number, score);
  }

  return scores;
}

async function commentAlreadyExists(marker: string): Promise<boolean> {
  for (let page = 1; ; page += 1) {
    const comments = await githubRequest<Array<{ body?: string }>>(
      `${api}/issues/${currentNumber}/comments?per_page=100&page=${page}`,
    );
    if (comments.some((comment) => comment.body?.includes(marker))) return true;
    if (comments.length < 100) return false;
  }
}

const candidates = await listAllIssues();
if (candidates.length === 0) {
  console.log("No other repository issues to compare.");
  process.exit(0);
}

const scores = await scoreCandidates(candidates);
const matches = selectMatches(candidates, scores, threshold, maximum);
if (matches.length === 0) {
  console.log(`No similar issue met the ${threshold} threshold.`);
  process.exit(0);
}

const marker = `<!-- jev-similar-issues-for:${currentNumber} -->`;
if (await commentAlreadyExists(marker)) {
  console.log(`A similarity comment already exists for issue #${currentNumber}.`);
  process.exit(0);
}

await githubRequest(`${api}/issues/${currentNumber}/comments`, {
  method: "POST",
  body: JSON.stringify({ body: buildDuplicateComment(ISSUE_AUTHOR, currentNumber, matches) }),
});
console.log(`Commented on issue #${currentNumber} with ${matches.length} potential duplicate(s).`);
