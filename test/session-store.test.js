"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getSession,
  listSessions,
  listWorkspaces,
  parseSessionFile
} = require("../src/session-store");
const { assistantTextFromEvent } = require("../src/codex-runner");
const { buildSkillPrompt, listSkills } = require("../src/skill-store");

test("parses Codex JSONL session metadata and user-facing messages", () => {
  const { filePath, workspace } = makeSessionFixture();
  const session = parseSessionFile(filePath, { includeMessages: true });

  assert.equal(session.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(session.cwd, workspace);
  assert.equal(session.title, "Build a bridge");
  assert.equal(session.messageCount, 2);
  assert.deepEqual(session.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(session.messages[1].text, "Done");
});

test("lists sessions filtered by exact workspace", () => {
  const { home, workspace, otherWorkspace } = makeSessionFixture();
  makeSessionFixture({ home, workspace: otherWorkspace, id: "22222222-2222-4222-8222-222222222222" });

  const sessions = listSessions({ codexHome: home, workspace });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "11111111-1111-4111-8111-111111111111");

  const workspaces = listWorkspaces({ codexHome: home });
  assert.equal(workspaces.length, 2);
});

test("loads one session with messages", () => {
  const { home, workspace } = makeSessionFixture();
  const session = getSession("11111111-1111-4111-8111-111111111111", {
    codexHome: home,
    workspace,
    includeMessages: true
  });
  assert.equal(session.messages.length, 2);
});

test("extracts assistant text from codex JSONL events", () => {
  assert.equal(
    assistantTextFromEvent({
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "fake answer"
      }
    }),
    "fake answer"
  );

  assert.equal(
    assistantTextFromEvent({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "final answer" }]
      }
    }),
    "final answer"
  );
});

test("lists local and plugin skills and builds a skill prompt", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-skills-"));
  const localDir = path.join(home, "skills", "plot-from-data");
  const pluginDir = path.join(home, "plugins", "cache", "openai-curated", "github", "abc123", "skills", "github");
  const tmpPluginDir = path.join(home, ".tmp", "plugins", "plugins", "figma", "skills", "figma-use");
  fs.mkdirSync(localDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(tmpPluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, "SKILL.md"),
    ["---", "name: plot-from-data", "description: Draw plots from data.", "---", "# Plot From Data"].join("\n")
  );
  fs.writeFileSync(
    path.join(pluginDir, "SKILL.md"),
    ["---", "name: github", "description: GitHub workflow.", "---", "# GitHub"].join("\n")
  );
  fs.writeFileSync(
    path.join(tmpPluginDir, "SKILL.md"),
    ["---", "name: figma-use", "description: Figma workflow.", "---", "# Figma Use"].join("\n")
  );

  const skills = listSkills({ codexHome: home });
  assert.deepEqual(skills.map((skill) => skill.id), ["plot-from-data", "figma:figma-use", "github:github"]);
  assert.equal(skills[1].source, "plugin");
  assert.match(buildSkillPrompt("hello", ["plot-from-data"]), /\$plot-from-data/);
});

function makeSessionFixture(options = {}) {
  const home = options.home || fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-home-"));
  const workspace = options.workspace || fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-workspace-"));
  const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-other-"));
  const id = options.id || "11111111-1111-4111-8111-111111111111";
  const dir = path.join(home, "sessions", "2026", "05", "18");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-2026-05-18T00-00-00-${id}.jsonl`);
  const lines = [
    {
      timestamp: "2026-05-18T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id,
        timestamp: "2026-05-18T00:00:00.000Z",
        cwd: workspace,
        originator: "codex-tui",
        cli_version: "0.130.0",
        source: "cli"
      }
    },
    {
      timestamp: "2026-05-18T00:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "internal" }]
      }
    },
    {
      timestamp: "2026-05-18T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Build a bridge" }]
      }
    },
    {
      timestamp: "2026-05-18T00:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Done" }]
      }
    }
  ];
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return { filePath, home, workspace, otherWorkspace };
}
