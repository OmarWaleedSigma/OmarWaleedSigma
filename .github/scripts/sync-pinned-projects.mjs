import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const username = "OmarWaleedSigma";
const startMarker = "<!-- PINNED-PROJECTS:START -->";
const endMarker = "<!-- PINNED-PROJECTS:END -->";

const query = `
  query PinnedRepositories($login: String!) {
    user(login: $login) {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
            name
            url
            description
            primaryLanguage {
              name
            }
            stargazerCount
          }
        }
      }
    }
  }
`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function validateRepository(repository) {
  if (
    !repository
    || typeof repository.name !== "string"
    || typeof repository.url !== "string"
    || !Number.isInteger(repository.stargazerCount)
  ) {
    throw new Error("GitHub returned a pinned repository with missing or invalid fields.");
  }

  const url = new URL(repository.url);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error(`GitHub returned an unexpected repository URL: ${repository.url}`);
  }
}

export function renderPinnedRepositories(repositories, newline = "\n") {
  if (!Array.isArray(repositories)) {
    throw new Error("Pinned repositories must be an array.");
  }

  if (repositories.length === 0) {
    return "<p>No pinned repositories found.</p>";
  }

  const cards = repositories.map((repository) => {
    validateRepository(repository);

    const description = typeof repository.description === "string"
      ? repository.description.replace(/\s+/g, " ").trim()
      : "";
    const language = typeof repository.primaryLanguage?.name === "string"
      ? repository.primaryLanguage.name
      : "";
    const details = [
      language && `<strong>Language:</strong> ${escapeHtml(language)}`,
      `<strong>Stars:</strong> ${repository.stargazerCount.toLocaleString("en-US")}`,
    ].filter(Boolean).join(" &middot; ");

    return [
      `  <td width="50%" valign="top">`,
      `    <h3><a href="${escapeHtml(repository.url)}">${escapeHtml(repository.name)}</a></h3>`,
      description && `    <p>${escapeHtml(description)}</p>`,
      `    <p>${details}</p>`,
      "  </td>",
    ].filter(Boolean).join(newline);
  });

  const rows = [];
  for (let index = 0; index < cards.length; index += 2) {
    rows.push([
      "<tr>",
      cards[index],
      cards[index + 1] ?? '  <td width="50%"></td>',
      "</tr>",
    ].join(newline));
  }

  return ["<table>", ...rows, "</table>"].join(newline);
}

export function replacePinnedProjectsSection(readme, generatedContent) {
  const startCount = readme.split(startMarker).length - 1;
  const endCount = readme.split(endMarker).length - 1;
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);

  if (startCount !== 1 || endCount !== 1 || start >= end) {
    throw new Error("README must contain exactly one ordered pair of pinned-project markers.");
  }

  const newline = readme.includes("\r\n") ? "\r\n" : "\n";
  const content = generatedContent.trim();
  return `${readme.slice(0, start + startMarker.length)}${newline}${content}${newline}${readme.slice(end)}`;
}

export async function syncPinnedProjects() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to fetch pinned repositories.");
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "OmarWaleedSigma-profile-readme-sync",
    },
    body: JSON.stringify({ query, variables: { login: username } }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
  }

  const result = await response.json();
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    throw new Error(`GitHub GraphQL request failed: ${result.errors.map((error) => error.message).join("; ")}`);
  }

  const repositories = result.data?.user?.pinnedItems?.nodes;
  if (!Array.isArray(repositories)) {
    throw new Error(`GitHub did not return pinned repositories for ${username}.`);
  }

  const readmePath = resolve(process.cwd(), "README.md");
  const readme = await readFile(readmePath, "utf8");
  const generated = renderPinnedRepositories(repositories, readme.includes("\r\n") ? "\r\n" : "\n");
  const updatedReadme = replacePinnedProjectsSection(readme, generated);

  if (updatedReadme === readme) {
    console.log("README already reflects the current pinned repositories.");
    return;
  }

  await writeFile(readmePath, updatedReadme, "utf8");
  console.log(`Updated the pinned-project section with ${repositories.length} repositories.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await syncPinnedProjects();
}
