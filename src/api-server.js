"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const {
  ensureDirectory,
  getSession,
  listSessions,
  listWorkspaces,
  normalizePath
} = require("./session-store");
const { pickFolder } = require("./folder-picker");
const { runCodexPrompt, runNewCodexPrompt } = require("./codex-runner");
const { listSkills } = require("./skill-store");

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

function startServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 3977);
  const defaultWorkspace = options.workspace ? normalizePath(options.workspace) : null;

  const server = http.createServer((req, res) => {
    route(req, res, { defaultWorkspace }).catch((error) => {
      sendJson(res, 500, { error: error.message || String(error) });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        url: `http://${host}:${address.port}`
      });
    });
  });
}

async function route(req, res, context) {
  setBaseHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, "http://127.0.0.1");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, defaultWorkspace: context.defaultWorkspace });
    return;
  }

  if (pathname === "/api/workspaces" && req.method === "GET") {
    sendJson(res, 200, { workspaces: listWorkspaces() });
    return;
  }

  if (pathname === "/api/skills" && req.method === "GET") {
    sendJson(res, 200, { skills: listSkills() });
    return;
  }

  if (pathname === "/api/workspace" && req.method === "POST") {
    const body = await readJsonBody(req);
    const workspace = ensureDirectory(body.path || context.defaultWorkspace || process.cwd());
    sendJson(res, 200, { workspace, sessions: listSessions({ workspace }) });
    return;
  }

  if (pathname === "/api/folder-picker" && req.method === "POST") {
    const folder = await pickFolder();
    sendJson(res, 200, { path: folder });
    return;
  }

  if (pathname === "/api/sessions" && req.method === "GET") {
    const workspace = requestUrl.searchParams.get("workspace") || context.defaultWorkspace;
    const sessions = listSessions({ workspace: workspace || undefined });
    sendJson(res, 200, { workspace: workspace || null, sessions });
    return;
  }

  const historyMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/history$/);
  if (historyMatch && req.method === "GET") {
    const workspace = requestUrl.searchParams.get("workspace") || context.defaultWorkspace;
    const session = getSession(historyMatch[1], {
      workspace: workspace || undefined,
      includeMessages: true
    });
    sendJson(res, 200, { session });
    return;
  }

  const chatMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/chat$/);
  if (chatMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    const sessionId = chatMatch[1];
    const session = getSession(sessionId, {
      workspace: body.workspace || context.defaultWorkspace || undefined
    });
    const message = requireMessage(body.message);
    const result = await runCodexPrompt({
      sessionId,
      message,
      skills: normalizeSkills(body.skills),
      workspace: body.workspace || session.cwd || context.defaultWorkspace || process.cwd(),
      codexBin: body.codexBin
    });
    const refreshed = safeGetSession(sessionId, {
      workspace: body.workspace || session.cwd || context.defaultWorkspace || undefined,
      includeMessages: true
    });
    sendJson(res, result.code === 0 ? 200 : 502, {
      ok: result.code === 0,
      session: refreshed,
      result: {
        code: result.code,
        signal: result.signal,
        stderr: result.stderr,
        nonJsonLines: result.nonJsonLines,
        assistantText: result.assistantText,
        events: result.events
      }
    });
    return;
  }

  const streamMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/chat\/stream$/);
  if (streamMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    const sessionId = streamMatch[1];
    const session = getSession(sessionId, {
      workspace: body.workspace || context.defaultWorkspace || undefined
    });
    const message = requireMessage(body.message);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const result = await runCodexPrompt({
      sessionId,
      message,
      skills: normalizeSkills(body.skills),
      workspace: body.workspace || session.cwd || context.defaultWorkspace || process.cwd(),
      codexBin: body.codexBin,
      onEvent: (event) => writeSse(res, "codex-event", event),
      onText: (text) => writeSse(res, "assistant-text", { text }),
      onNonJson: (line) => writeSse(res, "codex-line", { line })
    });

    writeSse(res, "done", {
      ok: result.code === 0,
      code: result.code,
      signal: result.signal,
      assistantText: result.assistantText
    });
    res.end();
    return;
  }

  if (pathname === "/api/sessions/new" && req.method === "POST") {
    const body = await readJsonBody(req);
    const workspace = ensureDirectory(body.workspace || context.defaultWorkspace || process.cwd());
    const message = requireMessage(body.message);
    const before = listSessions({ workspace }).map((session) => session.id);
    const result = await runNewCodexPrompt({
      workspace,
      message,
      skills: normalizeSkills(body.skills),
      codexBin: body.codexBin
    });
    const sessions = listSessions({ workspace });
    const created = sessions.find((session) => !before.includes(session.id)) || sessions[0] || null;
    const session = created
      ? safeGetSession(created.id, { workspace, includeMessages: true })
      : null;

    sendJson(res, result.code === 0 ? 200 : 502, {
      ok: result.code === 0,
      session,
      result: {
        code: result.code,
        signal: result.signal,
        stderr: result.stderr,
        nonJsonLines: result.nonJsonLines,
        assistantText: result.assistantText,
        events: result.events
      }
    });
    return;
  }

  if (req.method === "GET") {
    serveStatic(pathname, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function safeGetSession(sessionId, options) {
  try {
    return getSession(sessionId, options);
  } catch {
    return null;
  }
}

function requireMessage(value) {
  const message = String(value || "").trim();
  if (!message) throw new Error("message is required.");
  return message;
}

function normalizeSkills(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function setBaseHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, value) {
  if (!res.headersSent) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  }
  res.end(JSON.stringify(value, null, 2));
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(pathname, res) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(PUBLIC_DIR, relativePath);
  if (!candidate.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(candidate, (error, contents) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(candidate) });
    res.end(contents);
  });
}

function contentType(filePath) {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

module.exports = {
  startServer
};
