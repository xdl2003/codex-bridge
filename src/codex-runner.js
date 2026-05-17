"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { ensureDirectory, textFromContent } = require("./session-store");
const { buildSkillPrompt } = require("./skill-store");

function runCodexPrompt(options) {
  if (!options || !options.sessionId) throw new Error("sessionId is required.");
  if (!options.message) throw new Error("message is required.");
  const workspace = options.workspace ? ensureDirectory(options.workspace) : process.cwd();
  const args = [
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
    options.sessionId,
    "-"
  ];
  return runCodex(args, {
    cwd: workspace,
    input: buildSkillPrompt(options.message, options.skills),
    codexBin: options.codexBin,
    onEvent: options.onEvent,
    onNonJson: options.onNonJson,
    onText: options.onText
  });
}

function runNewCodexPrompt(options) {
  if (!options || !options.message) throw new Error("message is required.");
  const workspace = ensureDirectory(options.workspace || process.cwd());
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C",
    workspace,
    "-"
  ];
  return runCodex(args, {
    cwd: workspace,
    input: buildSkillPrompt(options.message, options.skills),
    codexBin: options.codexBin,
    onEvent: options.onEvent,
    onNonJson: options.onNonJson,
    onText: options.onText
  });
}

function openCodexTui(options) {
  if (!options || !options.sessionId) throw new Error("sessionId is required.");
  const workspace = ensureDirectory(options.workspace || process.cwd());
  const child = spawn(options.codexBin || "codex", ["resume", "--no-alt-screen", options.sessionId], {
    cwd: workspace,
    stdio: "inherit"
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function runCodex(args, options) {
  const codexBin = options.codexBin || "codex";
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const events = [];
  const nonJsonLines = [];
  const textChunks = [];
  let stdout = "";
  let stderr = "";
  let stdoutRemainder = "";

  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    child.once("error", reject);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutRemainder = processStdoutLines(stdoutRemainder + text, {
        events,
        nonJsonLines,
        textChunks,
        onEvent: options.onEvent,
        onNonJson: options.onNonJson,
        onText: options.onText
      });
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (typeof options.onStderr === "function") options.onStderr(text);
    });

    child.stdin.end(options.input.endsWith("\n") ? options.input : `${options.input}\n`);

    child.once("close", (code, signal) => {
      if (stdoutRemainder.trim()) {
        processStdoutLines(`${stdoutRemainder}\n`, {
          events,
          nonJsonLines,
          textChunks,
          onEvent: options.onEvent,
          onNonJson: options.onNonJson,
          onText: options.onText
        });
      }

      resolve({
        code,
        signal,
        stdout,
        stderr,
        events,
        nonJsonLines,
        assistantText: collectAssistantText(events, textChunks, stdout)
      });
    });
  });
}

function processStdoutLines(buffer, sinks) {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      sinks.nonJsonLines.push(line);
      if (typeof sinks.onNonJson === "function") sinks.onNonJson(line);
      continue;
    }

    sinks.events.push(event);
    if (typeof sinks.onEvent === "function") sinks.onEvent(event);

    const text = assistantTextFromEvent(event);
    if (text) {
      sinks.textChunks.push(text);
      if (typeof sinks.onText === "function") sinks.onText(text);
    }
  }
  return remainder;
}

function collectAssistantText(events, textChunks, stdout) {
  if (textChunks.length) return textChunks[textChunks.length - 1];

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const text = assistantTextFromEvent(events[index]);
    if (text) return text;
  }

  const lastNonEmpty = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return lastNonEmpty || "";
}

function assistantTextFromEvent(event) {
  if (!event || typeof event !== "object") return "";

  const candidates = [
    event,
    event.payload,
    event.item,
    event.message,
    event.response_item,
    event.event
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    if (candidate.type === "agent_message" && typeof candidate.message === "string") {
      return candidate.message.trim();
    }

    if (candidate.role === "assistant") {
      const text = textFromContent(candidate.content || candidate.text || candidate.output);
      if (text) return text;
    }

    if (candidate.type === "message" && candidate.role === "assistant") {
      const text = textFromContent(candidate.content);
      if (text) return text;
    }

    if (typeof candidate.delta === "string" && candidate.role === "assistant") {
      return candidate.delta.trim();
    }
  }

  if (event.type === "agent_message" && typeof event.message === "string") {
    return event.message.trim();
  }

  return "";
}

module.exports = {
  assistantTextFromEvent,
  openCodexTui,
  runCodexPrompt,
  runNewCodexPrompt
};
