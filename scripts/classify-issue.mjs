import { OpenRouter } from "@openrouter/sdk";

const labels = ["bug", "enhancement", "documentation", "other"];
const { OPENROUTER_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY } = process.env;

if (!OPENROUTER_API_KEY || !GITHUB_TOKEN || !GITHUB_REPOSITORY || !ISSUE_NUMBER) {
  throw new Error("Missing required OpenRouter or GitHub Actions environment variables.");
}

const client = new OpenRouter({ apiKey: OPENROUTER_API_KEY });
const result = await client.alpha.decisions.create({
  decisionsRequest: {
    model: process.env.OPENROUTER_MODEL || "~typesafe/jev-latest",
    sessionId: `github-issue-${GITHUB_REPOSITORY}-${ISSUE_NUMBER}`,
    state: {
      title: ISSUE_TITLE || "",
      body: ISSUE_BODY || "",
      allowedLabels: labels,
    },
    questions: {
      classification: {
        type: "choice",
        instructions: "Classify this GitHub issue using exactly one allowed label. bug: something is broken or incorrect. enhancement: a new capability or enhancement. documentation: documentation-only change. other: unclear, discussion, or anything else. Choose the main requested outcome; use other when insufficient information is provided.",
        criteria: Object.fromEntries(labels.map((label) => [label, { description: label }])),
      },
    },
  },
});

const classification = result.answers.classification;
if (classification?.type !== "choice" || !labels.includes(classification.choice)) {
  throw new Error("JEV returned a classification outside the allowed labels.");
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

async function githubRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) {
    throw new Error(`GitHub API ${options.method || "GET"} failed (${response.status}): ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

const labelUrl = `${api}/labels/${encodeURIComponent(classification.choice)}`;
const existingLabel = await fetch(labelUrl, { headers });
if (existingLabel.status === 404) {
  await githubRequest(`${api}/labels`, {
    method: "POST",
    body: JSON.stringify({ name: classification.choice, color: "5319e7" }),
  });
} else if (!existingLabel.ok) {
  throw new Error(`Unable to check repository label (${existingLabel.status}): ${await existingLabel.text()}`);
}

await githubRequest(`${api}/issues/${ISSUE_NUMBER}/labels`, {
  method: "POST",
  body: JSON.stringify({ labels: [classification.choice] }),
});

console.log(`Applied label "${classification.choice}" to issue #${ISSUE_NUMBER}.`);
