import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  renderPinnedRepositories,
  replacePinnedProjectsSection,
  syncPinnedProjects,
} from "./sync-pinned-projects.mjs";

const repository = {
  name: "Example <Project>",
  nameWithOwner: "OmarWaleedSigma/example",
  url: "https://github.com/OmarWaleedSigma/example",
  description: 'A project & "description".',
  primaryLanguage: { name: "JavaScript" },
  stargazerCount: 1234,
};

test("renders pinned repositories as escaped cards with their metadata", () => {
  const rendered = renderPinnedRepositories([repository]);

  assert.match(rendered, /Example &lt;Project&gt;/);
  assert.match(rendered, /A project &amp; &quot;description&quot;\./);
  assert.match(rendered, /Language:<\/strong> JavaScript/);
  assert.match(rendered, /Stars:<\/strong> 1,234/);
  assert.doesNotMatch(rendered, /<Project>/);
});

test("renders an empty-state message when there are no pinned repositories", () => {
  assert.equal(renderPinnedRepositories([]), "<p>No pinned repositories found.</p>");
});

test("rejects repository links outside github.com", () => {
  assert.throws(
    () => renderPinnedRepositories([{ ...repository, url: "https://example.com/project" }]),
    /unexpected repository URL/,
  );
});

test("replaces only the content between the README markers", () => {
  const readme = `Before\n<!-- PINNED-PROJECTS:START -->\nOld content\n<!-- PINNED-PROJECTS:END -->\nAfter\n`;

  assert.equal(
    replacePinnedProjectsSection(readme, "<p>New content</p>"),
    `Before\n<!-- PINNED-PROJECTS:START -->\n<p>New content</p>\n<!-- PINNED-PROJECTS:END -->\nAfter\n`,
  );
});

test("replacing the same generated section is idempotent", () => {
  const content = renderPinnedRepositories([repository]);
  const readme = `Before\n<!-- PINNED-PROJECTS:START -->\n${content}\n<!-- PINNED-PROJECTS:END -->\nAfter\n`;

  assert.equal(replacePinnedProjectsSection(readme, content), readme);
});

test("syncs repository metadata into the README without duplicating content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pinned-projects-"));
  const previousDirectory = process.cwd();
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  const initialReadme = "Before\n<!-- PINNED-PROJECTS:START -->\nPlaceholder\n<!-- PINNED-PROJECTS:END -->\nAfter\n";

  try {
    await writeFile(join(directory, "README.md"), initialReadme);
    process.chdir(directory);
    process.env.GITHUB_TOKEN = "test-token";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: { user: { pinnedItems: { nodes: [repository] } } } }),
    });

    await syncPinnedProjects();
    const updatedReadme = await readFile(join(directory, "README.md"), "utf8");
    assert.match(updatedReadme, /Example &lt;Project&gt;/);
    assert.ok(updatedReadme.startsWith("Before\n"));
    assert.ok(updatedReadme.endsWith("\nAfter\n"));

    await syncPinnedProjects();
    assert.equal(await readFile(join(directory, "README.md"), "utf8"), updatedReadme);
  } finally {
    process.chdir(previousDirectory);
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects missing or duplicate README markers", () => {
  assert.throws(
    () => replacePinnedProjectsSection("No markers", "Content"),
    /exactly one ordered pair/,
  );
  assert.throws(
    () => replacePinnedProjectsSection(
      "<!-- PINNED-PROJECTS:START --><!-- PINNED-PROJECTS:START --><!-- PINNED-PROJECTS:END -->",
      "Content",
    ),
    /exactly one ordered pair/,
  );
});
