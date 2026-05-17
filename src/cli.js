"use strict";

const readline = require("readline");
const { spawn } = require("child_process");
const {
  ensureDirectory,
  getSession,
  listSessions,
  listWorkspaces,
  normalizePath
} = require("./session-store");
const { openCodexTui, runCodexPrompt, runNewCodexPrompt } = require("./codex-runner");
const { startServer } = require("./api-server");

async function main(argv) {
  const parsed = parseArgs(argv);
  const command = parsed.args[0] || "interactive";

  if (parsed.options.help || command === "help") {
    printUsage();
    return;
  }

  if (command === "server" || command === "serve" || command === "web") {
    await commandServer(parsed);
    return;
  }

  if (command === "sessions") {
    commandSessions(parsed);
    return;
  }

  if (command === "workspaces") {
    printJsonOrText({ workspaces: listWorkspaces() }, parsed.options.json, () => {
      for (const workspace of listWorkspaces()) {
        console.log(`${workspace.latestAt || "-"}  ${workspace.sessionCount}  ${workspace.path}`);
      }
    });
    return;
  }

  if (command === "history") {
    commandHistory(parsed);
    return;
  }

  if (command === "chat") {
    await commandChat(parsed);
    return;
  }

  if (command === "new") {
    await commandNew(parsed);
    return;
  }

  if (command === "tui") {
    await commandTui(parsed);
    return;
  }

  await interactive(parsed);
}

async function commandServer(parsed) {
  const serverOptions = {
    host: parsed.options.host || "127.0.0.1",
    port: parsed.options.port || 3977,
    workspace: parsed.options.workspace
  };
  const result = await startServer(serverOptions);
  console.log(`Codex Bridge web/API: ${result.url}`);
  console.log("Press Ctrl+C to stop.");
}

function commandSessions(parsed) {
  const workspace = parsed.options.workspace ? ensureDirectory(parsed.options.workspace) : undefined;
  const sessions = listSessions({ workspace });
  printJsonOrText({ workspace: workspace || null, sessions }, parsed.options.json, () => {
    printSessions(sessions);
  });
}

function commandHistory(parsed) {
  const sessionId = parsed.args[1];
  if (!sessionId) throw new Error("Usage: codex-bridge history <session-id> [--workspace DIR]");
  const workspace = parsed.options.workspace ? ensureDirectory(parsed.options.workspace) : undefined;
  const session = getSession(sessionId, { workspace, includeMessages: true });
  printJsonOrText({ session }, parsed.options.json, () => {
    printSessionHeader(session);
    printHistory(session.messages);
  });
}

async function commandChat(parsed) {
  const sessionId = parsed.args[1];
  if (!sessionId) throw new Error("Usage: codex-bridge chat <session-id> [message] [--workspace DIR]");
  const message = parsed.args.slice(2).join(" ") || (await readStdin());
  if (!message.trim()) throw new Error("message is required.");

  const session = getSession(sessionId, {
    workspace: parsed.options.workspace || undefined
  });
  const result = await runCodexPrompt({
    sessionId,
    message,
    workspace: parsed.options.workspace || session.cwd || process.cwd(),
    codexBin: parsed.options.codexBin,
    skills: normalizeSkillOptions(parsed.options)
  });

  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.assistantText) console.log(result.assistantText);
    if (result.code !== 0) {
      console.error(result.stderr || `codex exited with ${result.code}`);
      process.exitCode = result.code || 1;
    }
  }
}

async function commandNew(parsed) {
  const workspace = ensureDirectory(parsed.options.workspace || process.cwd());
  const message = parsed.args.slice(1).join(" ") || (await readStdin());
  if (!message.trim()) throw new Error("message is required.");
  const before = listSessions({ workspace }).map((session) => session.id);
  const result = await runNewCodexPrompt({
    workspace,
    message,
    codexBin: parsed.options.codexBin,
    skills: normalizeSkillOptions(parsed.options)
  });
  const sessions = listSessions({ workspace });
  const created = sessions.find((session) => !before.includes(session.id)) || sessions[0] || null;
  if (parsed.options.json) {
    console.log(JSON.stringify({ result, session: created }, null, 2));
  } else {
    if (created) console.log(`Session: ${created.id}`);
    if (result.assistantText) console.log(result.assistantText);
    if (result.code !== 0) {
      console.error(result.stderr || `codex exited with ${result.code}`);
      process.exitCode = result.code || 1;
    }
  }
}

async function commandTui(parsed) {
  const sessionId = parsed.args[1];
  if (!sessionId) throw new Error("Usage: codex-bridge tui <session-id> [--workspace DIR]");
  const session = getSession(sessionId, {
    workspace: parsed.options.workspace || undefined
  });
  const result = await openCodexTui({
    sessionId,
    workspace: parsed.options.workspace || session.cwd || process.cwd(),
    codexBin: parsed.options.codexBin
  });
  process.exitCode = result.code || 0;
}

async function interactive(parsed) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const ask = (question) => new Promise((resolve) => rl.question(question, resolve));
    const defaultWorkspace = normalizePath(parsed.options.workspace || process.cwd());
    const inputWorkspace = await ask(`Target folder [${defaultWorkspace}]: `);
    const workspace = ensureDirectory(inputWorkspace.trim() || defaultWorkspace);

    let sessions = listSessions({ workspace });
    if (!sessions.length) {
      console.log(`No Codex sessions found for ${workspace}.`);
      const firstMessage = await ask("Start a new session, message (empty to quit): ");
      if (!firstMessage.trim()) return;
      const result = await runNewCodexPrompt({
        workspace,
        message: firstMessage,
        codexBin: parsed.options.codexBin
      });
      if (result.assistantText) console.log(`\nassistant:\n${result.assistantText}\n`);
      sessions = listSessions({ workspace });
    }

    printSessions(sessions);
    const answer = await ask("Resume session number/id: ");
    const selected = selectSession(sessions, answer.trim());
    if (!selected) throw new Error("No session selected.");

    console.log(`Resumed ${selected.id}`);
    const session = getSession(selected.id, { workspace, includeMessages: true });
    printHistory(session.messages.slice(-12));

    for (;;) {
      const message = await ask("\ncodex> ");
      const trimmed = message.trim();
      if (!trimmed) continue;
      if (trimmed === "/quit" || trimmed === "/exit") break;
      if (trimmed === "/history") {
        const refreshed = getSession(selected.id, { workspace, includeMessages: true });
        printHistory(refreshed.messages);
        continue;
      }
      if (trimmed === "/sessions") {
        sessions = listSessions({ workspace });
        printSessions(sessions);
        continue;
      }
      if (trimmed === "/tui") {
        rl.pause();
        await openCodexTui({
          sessionId: selected.id,
          workspace,
          codexBin: parsed.options.codexBin
        });
        rl.resume();
        continue;
      }
      if (trimmed === "/web") {
        const result = await startServer({ workspace, port: parsed.options.port || 3977 });
        console.log(`Web/API: ${result.url}`);
        continue;
      }

      console.log("Running Codex...");
      const result = await runCodexPrompt({
        sessionId: selected.id,
        workspace,
        message,
        codexBin: parsed.options.codexBin,
        skills: normalizeSkillOptions(parsed.options)
      });

      if (result.assistantText) {
        console.log(`\nassistant:\n${result.assistantText}`);
      }
      if (result.code !== 0) {
        console.error(result.stderr || `codex exited with ${result.code}`);
      }
    }
  } finally {
    rl.close();
  }
}

function selectSession(sessions, value) {
  if (!value) return null;
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= sessions.length) {
    return sessions[number - 1];
  }
  return sessions.find((session) => session.id === value || session.id.startsWith(value));
}

function printSessions(sessions) {
  if (!sessions.length) {
    console.log("No sessions found.");
    return;
  }
  sessions.forEach((session, index) => {
    const when = session.timestamp || session.lastEventAt || "-";
    console.log(`${index + 1}. ${when}  ${session.id}`);
    console.log(`   ${session.title}`);
  });
}

function printSessionHeader(session) {
  console.log(`${session.id}`);
  console.log(`${session.cwd || "-"}`);
  console.log(`${session.title}`);
  console.log("");
}

function printHistory(messages) {
  for (const message of messages || []) {
    if (!["user", "assistant"].includes(message.role)) continue;
    const phase = message.phase ? `:${message.phase}` : "";
    console.log(`\n${message.role}${phase}:`);
    console.log(message.text);
  }
}

function printJsonOrText(value, json, printText) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    printText();
  }
}

function parseArgs(argv) {
  const options = {};
  const args = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("-")) {
      args.push(arg);
      continue;
    }

    if (arg === "--") {
      args.push(...argv.slice(index + 1));
      break;
    }

    const [rawKey, inlineValue] = arg.replace(/^--?/, "").split("=", 2);
    const key = aliases(rawKey);
    if (["json", "help"].includes(key)) {
      options[key] = true;
      continue;
    }
    const next = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (key === "skill" || key === "skills") {
      const existing = options.skills || [];
      options.skills = existing.concat(String(next || "").split(",").map((item) => item.trim()).filter(Boolean));
    } else {
      options[key] = next;
    }
  }

  return { args, options };
}

function normalizeSkillOptions(options) {
  return Array.from(new Set(options.skills || []));
}

function aliases(key) {
  switch (key) {
    case "w":
    case "cwd":
      return "workspace";
    case "p":
      return "port";
    case "h":
      return "help";
    case "codex-bin":
      return "codexBin";
    default:
      return key;
  }
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.on("data", (chunk) => {
      text += chunk.toString("utf8");
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

function printUsage() {
  console.log(`codex-bridge

Usage:
  codex-bridge                         interactive folder/session picker
  codex-bridge server [--port 3977]    start HTTP API and web UI
  codex-bridge sessions --workspace DIR [--json]
  codex-bridge history <session-id> [--workspace DIR] [--json]
  codex-bridge chat <session-id> "message" [--workspace DIR] [--skill NAME] [--json]
  codex-bridge new "message" --workspace DIR [--skill NAME] [--json]
  codex-bridge tui <session-id> [--workspace DIR]

Interactive commands:
  /history   reload current session history
  /sessions  list sessions in the target folder
  /tui       open Codex TUI for the selected session
  /web       start the web/API server
  /quit      exit
`);
}

module.exports = {
  main,
  parseArgs
};
