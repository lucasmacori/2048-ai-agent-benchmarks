import { describe, expect, it } from "vitest";
import {
  buildDuplicateComment,
  parseMaxMatches,
  parseThreshold,
  selectMatches,
  SIMILARITY_LEVELS,
  similarityQuestions,
  readSimilarityScores,
  type IssueCandidate,
} from "../scripts/issue-similarity.js";

const candidates: IssueCandidate[] = [
  { number: 3, title: "Second", body: "", state: "closed", html_url: "https://example.test/3" },
  { number: 2, title: "First", body: "", state: "open", html_url: "https://example.test/2" },
  { number: 4, title: "Below threshold", body: "", state: "open", html_url: "https://example.test/4" },
];

describe("issue similarity helpers", () => {
  it("uses an explicit score rubric and maps answers by candidate number", () => {
    const questions = similarityQuestions(candidates);
    expect(questions.issue_3.type).toBe("score");
    expect(questions.issue_3.criteria).toEqual(SIMILARITY_LEVELS);
    const scores = readSimilarityScores(candidates, {
      issue_4: { type: "score", score: 6.75 },
      issue_2: { type: "score", score: 7.65 },
      issue_3: { type: "score", score: 8.37 },
    });
    expect(selectMatches(candidates, scores, 0.85, 3).map(issue => issue.number)).toEqual([3, 2]);
    expect(scores.get(3)).toBeCloseTo(0.93);
  });

  it.each([
    undefined, { type: "choice", choice: "similar" },
    { type: "score", score: "0.9" }, { type: "score", score: NaN },
    { type: "score", score: -1 }, { type: "score", score: 10 },
  ])("rejects invalid answers with targeted diagnostics: %j", (answer) => {
    expect(() => readSimilarityScores([candidates[0]], { issue_3: answer })).toThrow(/candidate.*3.*answerKeys.*issue_3.*scoreType/);
  });

  it("reports missing response keys without leaking issue content", () => {
    expect(() => readSimilarityScores([candidates[0]], { issue_2: { type: "score", score: 1 } })).toThrow(/answerType.*missing/);
  });
  it("parses and validates the configured threshold and match count", () => {
    expect(parseThreshold(undefined)).toBe(0.85);
    expect(parseThreshold("1")).toBe(1);
    expect(() => parseThreshold("1.1")).toThrow();
    expect(parseMaxMatches(undefined)).toBe(3);
    expect(() => parseMaxMatches("0")).toThrow();
  });

  it("keeps matches at the threshold, ranks them, and limits the results", () => {
    const matches = selectMatches(candidates, new Map([[3, 0.93], [2, 0.85], [4, 0.84]]), 0.85, 1);
    expect(matches.map(({ number }) => number)).toEqual([3]);
  });

  it("formats a mention, links, scores, and closed status", () => {
    const matches = selectMatches(candidates, new Map([[3, 0.93]]), 0.85, 3);
    const comment = buildDuplicateComment("contributor", 10, matches);
    expect(comment).toContain("@contributor");
    expect(comment).toContain("<!-- jev-similar-issues-for:10 -->");
    expect(comment).toContain("[#3 — Second](https://example.test/3) (closed)");
    expect(comment).toContain("93%");
  });
});
