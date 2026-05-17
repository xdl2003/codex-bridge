"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function sessionsRoot(home = codexHome()) {
  return path.join(home, "sessions");
}

function normalizePath(inputPath) {
  if (!inputPath) return null;
  return path.resolve(expandHome(inputPath));
}

function comparePath(inputPath) {
  const resolved = normalizePath(inputPath);
  if (!resolved) return null;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function ensureDirectory(inputPath) {
  const resolved = normalizePath(inputPath);
  if (!resolved) throw new Error("Path is required.");
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  return resolved;
}

function listSessionFiles(root = sessionsRoot()) {
  const files = [];
  if (!fs.existsSync(root)) return files;

  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function textFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return objectText(content);

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return objectText(part);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function objectText(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "output_text", "input_text", "message", "content"]) {
    const current = value[key];
    if (typeof current === "string") return current;
  }
  return "";
}

function normalizeMessage(payload, timestamp, index) {
  if (!payload || payload.type !== "message") return null;
  const text = textFromContent(payload.content);
  if (!text) return null;
  return {
    id: `${timestamp || "unknown"}-${index}`,
    timestamp: timestamp || null,
    role: payload.role || "unknown",
    phase: payload.phase || null,
    text
  };
}

function trimTitle(text, maxLength = 90) {
  const singleLine = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!singleLine) return "Untitled session";
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}...`;
}

function parseSessionFile(filePath, options = {}) {
  const includeMessages = Boolean(options.includeMessages);
  const includeInternal = Boolean(options.includeInternal);
  const messages = [];
  const summary = {
    id: null,
    title: null,
    cwd: null,
    timestamp: null,
    lastEventAt: null,
    cliVersion: null,
    source: null,
    originator: null,
    threadSource: null,
    filePath,
    messageCount: 0
  };

  let firstUserText = "";
  let lineIndex = 0;

  let contents = "";
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return { ...summary, error: error.message, messages: includeMessages ? messages : undefined };
  }

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineIndex += 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.timestamp) summary.lastEventAt = entry.timestamp;

    if (entry.type === "session_meta" && entry.payload) {
      const payload = entry.payload;
      summary.id = payload.id || summary.id;
      summary.cwd = payload.cwd || summary.cwd;
      summary.timestamp = payload.timestamp || summary.timestamp;
      summary.cliVersion = payload.cli_version || payload.cliVersion || summary.cliVersion;
      summary.source = payload.source || summary.source;
      summary.originator = payload.originator || summary.originator;
      summary.threadSource = payload.thread_source || summary.threadSource;
      continue;
    }

    if (entry.type === "turn_context" && entry.payload && entry.payload.cwd && !summary.cwd) {
      summary.cwd = entry.payload.cwd;
      continue;
    }

    if (entry.type === "response_item") {
      const message = normalizeMessage(entry.payload, entry.timestamp, lineIndex);
      if (!message) continue;
      if (!includeInternal && !["user", "assistant"].includes(message.role)) continue;
      if (!includeInternal && isInternalMessage(message)) continue;

      summary.messageCount += 1;
      if (message.role === "user" && !firstUserText) firstUserText = message.text;
      if (includeMessages) messages.push(message);
    }
  }

  if (!summary.id) summary.id = idFromFilename(filePath);
  summary.title = trimTitle(firstUserText || path.basename(filePath, ".jsonl"));

  return includeMessages ? { ...summary, messages } : summary;
}

function isInternalMessage(message) {
  if (!message || message.role !== "user") return false;
  const text = String(message.text || "").trim();
  return text.startsWith("<environment_context>") || text.startsWith("<turn_aborted>");
}

function idFromFilename(filePath) {
  const match = path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : path.basename(filePath, ".jsonl");
}

function matchesWorkspace(session, workspace) {
  if (!workspace) return true;
  if (!session.cwd) return false;
  return comparePath(session.cwd) === comparePath(workspace);
}

function listSessions(options = {}) {
  const root = options.root || sessionsRoot(options.codexHome);
  const workspace = options.workspace ? normalizePath(options.workspace) : null;
  const includeMessages = Boolean(options.includeMessages);

  return listSessionFiles(root)
    .map((filePath) => parseSessionFile(filePath, { includeMessages }))
    .filter((session) => options.includeInternalSessions || !isInternalSession(session))
    .filter((session) => session.id && matchesWorkspace(session, workspace))
    .sort((a, b) => String(b.timestamp || b.lastEventAt || "").localeCompare(String(a.timestamp || a.lastEventAt || "")));
}

function getSession(sessionId, options = {}) {
  if (!sessionId) throw new Error("Session id is required.");
  const sessions = listSessions({ ...options, includeMessages: Boolean(options.includeMessages) });
  const session = sessions.find((candidate) => candidate.id === sessionId || candidate.title === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

function listWorkspaces(options = {}) {
  const seen = new Map();
  for (const session of listSessions(options)) {
    if (!session.cwd) continue;
    const key = comparePath(session.cwd);
    if (!seen.has(key)) {
      seen.set(key, {
        path: session.cwd,
        sessionCount: 0,
        latestAt: null
      });
    }
    const item = seen.get(key);
    item.sessionCount += 1;
    const latest = session.timestamp || session.lastEventAt;
    if (latest && (!item.latestAt || latest > item.latestAt)) item.latestAt = latest;
  }

  return Array.from(seen.values()).sort((a, b) => String(b.latestAt || "").localeCompare(String(a.latestAt || "")));
}

function isInternalSession(session) {
  if (!session) return false;
  if (session.threadSource && session.threadSource !== "user") return true;
  if (session.source && typeof session.source === "object" && session.source.subagent) return true;
  return false;
}

module.exports = {
  codexHome,
  comparePath,
  ensureDirectory,
  expandHome,
  getSession,
  listSessionFiles,
  listSessions,
  listWorkspaces,
  normalizePath,
  parseSessionFile,
  sessionsRoot,
  textFromContent
};
