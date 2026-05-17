"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensureDirectory, getSession, normalizePath } = require("./session-store");

const STORE_VERSION = 1;
const DEFAULT_INTERVAL_MINUTES = 60;
const runningJobIds = new Set();

function bridgeHome() {
  return process.env.CODEX_BRIDGE_HOME || path.join(os.homedir(), ".codex-bridge");
}

function jobsFile(home = bridgeHome()) {
  return path.join(home, "jobs.json");
}

function listJobs(options = {}) {
  const workspace = options.workspace ? normalizePath(options.workspace) : null;
  return readStore(options)
    .jobs.filter((job) => !workspace || normalizePath(job.workspace) === workspace)
    .map((job) => ({ ...job, running: runningJobIds.has(job.id) }))
    .sort((a, b) => String(a.nextRunAt || "").localeCompare(String(b.nextRunAt || "")));
}

function getJob(jobId, options = {}) {
  const job = readStore(options).jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return { ...job, running: runningJobIds.has(job.id) };
}

function createJob(input, options = {}) {
  const now = nowIso(options.now);
  const workspace = ensureDirectory(input.workspace || process.cwd());
  const sessionId = normalizeRequiredString(input.sessionId, "sessionId");
  validateSession(sessionId, workspace, options);

  const prompt = normalizePrompt(input.prompt);
  const repeat = input.repeat !== false;
  const intervalInput = input.intervalMinutes !== undefined ? input.intervalMinutes : input.every;
  const intervalMinutes = repeat ? normalizeInterval(intervalInput) : null;
  const nextRunAt = normalizeRunAt(
    input.nextRunAt || input.firstRunAt || defaultNextRunAt(intervalMinutes || DEFAULT_INTERVAL_MINUTES, options.now),
    "nextRunAt"
  );

  const job = {
    id: crypto.randomUUID(),
    name: normalizeName(input.name, prompt),
    workspace,
    sessionId,
    prompt,
    skills: normalizeSkills(input.skills),
    repeat,
    intervalMinutes,
    enabled: input.enabled !== false,
    nextRunAt,
    lastRunAt: null,
    lastResult: null,
    runCount: 0,
    createdAt: now,
    updatedAt: now
  };

  const store = readStore(options);
  store.jobs.push(job);
  writeStore(store, options);
  return { ...job, running: false };
}

function updateJob(jobId, patch, options = {}) {
  const store = readStore(options);
  const index = store.jobs.findIndex((job) => job.id === jobId);
  if (index === -1) throw new Error(`Job not found: ${jobId}`);

  const current = store.jobs[index];
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    next.name = normalizeName(patch.name, next.prompt);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "prompt")) {
    next.prompt = normalizePrompt(patch.prompt);
    if (!patch.name && next.name === normalizeName(current.name, current.prompt)) {
      next.name = normalizeName(next.name, next.prompt);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "skills")) {
    next.skills = normalizeSkills(patch.skills);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    next.enabled = Boolean(patch.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "repeat")) {
    next.repeat = Boolean(patch.repeat);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "intervalMinutes") || Object.prototype.hasOwnProperty.call(patch, "every")) {
    const intervalInput = patch.intervalMinutes !== undefined ? patch.intervalMinutes : patch.every;
    next.intervalMinutes = normalizeInterval(intervalInput);
    next.repeat = true;
  }
  if (!next.repeat) next.intervalMinutes = null;
  if (Object.prototype.hasOwnProperty.call(patch, "nextRunAt") || Object.prototype.hasOwnProperty.call(patch, "firstRunAt")) {
    next.nextRunAt = normalizeRunAt(patch.nextRunAt || patch.firstRunAt, "nextRunAt");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "workspace")) {
    next.workspace = ensureDirectory(patch.workspace);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "sessionId")) {
    next.sessionId = normalizeRequiredString(patch.sessionId, "sessionId");
  }

  if (next.workspace !== current.workspace || next.sessionId !== current.sessionId) {
    validateSession(next.sessionId, next.workspace, options);
  }

  next.updatedAt = nowIso(options.now);
  store.jobs[index] = next;
  writeStore(store, options);
  return { ...next, running: runningJobIds.has(next.id) };
}

function deleteJob(jobId, options = {}) {
  const store = readStore(options);
  const nextJobs = store.jobs.filter((job) => job.id !== jobId);
  if (nextJobs.length === store.jobs.length) throw new Error(`Job not found: ${jobId}`);
  store.jobs = nextJobs;
  writeStore(store, options);
  runningJobIds.delete(jobId);
}

async function runDueJobs(options = {}) {
  const now = new Date(options.now || Date.now());
  const dueJobs = listJobs(options).filter((job) => {
    if (!job.enabled || job.running || !job.nextRunAt) return false;
    const nextRun = new Date(job.nextRunAt);
    return Number.isFinite(nextRun.getTime()) && nextRun <= now;
  });

  const results = [];
  for (const job of dueJobs) {
    results.push(await runJob(job.id, options));
  }
  return results;
}

async function runJob(jobId, options = {}) {
  const runner = options.runner;
  if (typeof runner !== "function") throw new Error("runner is required.");

  const job = getJob(jobId, options);
  if (!job.enabled && !options.force) throw new Error(`Job is disabled: ${jobId}`);
  if (runningJobIds.has(jobId)) throw new Error(`Job is already running: ${jobId}`);

  runningJobIds.add(jobId);
  const startedAt = nowIso(options.now);
  let result;

  try {
    const rawResult = await runner({
      sessionId: job.sessionId,
      workspace: job.workspace,
      message: job.prompt,
      skills: job.skills
    });
    result = normalizeRunResult(rawResult, startedAt, options.now);
  } catch (error) {
    result = {
      ok: false,
      code: null,
      signal: null,
      startedAt,
      finishedAt: nowIso(options.now),
      assistantText: "",
      stderr: "",
      error: error.message || String(error)
    };
  } finally {
    runningJobIds.delete(jobId);
  }

  const updated = recordRunResult(jobId, result, options);
  return { job: updated, result };
}

function recordRunResult(jobId, result, options = {}) {
  const store = readStore(options);
  const index = store.jobs.findIndex((job) => job.id === jobId);
  if (index === -1) throw new Error(`Job not found: ${jobId}`);

  const current = store.jobs[index];
  const finishedAt = result.finishedAt || nowIso();
  const enabled = current.repeat ? current.enabled : false;
  const nextRunAt = current.repeat ? nextIntervalRunAt(current, finishedAt) : null;
  const updated = {
    ...current,
    enabled,
    nextRunAt,
    lastRunAt: finishedAt,
    lastResult: compactRunResult(result),
    runCount: Number(current.runCount || 0) + 1,
    updatedAt: finishedAt
  };

  store.jobs[index] = updated;
  writeStore(store, options);
  return { ...updated, running: false };
}

function readStore(options = {}) {
  const file = storePath(options);
  if (!fs.existsSync(file)) return { version: STORE_VERSION, jobs: [] };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read jobs store: ${error.message}`);
  }

  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.map(normalizeStoredJob).filter(Boolean) : [];
  return { version: STORE_VERSION, jobs };
}

function writeStore(store, options = {}) {
  const file = storePath(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({ version: STORE_VERSION, jobs: store.jobs.map(normalizeStoredJob).filter(Boolean) }, null, 2);
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${payload}\n`);
  fs.renameSync(tempFile, file);
}

function storePath(options = {}) {
  return options.file || jobsFile(options.home || bridgeHome());
}

function validateSession(sessionId, workspace, options) {
  if (options.skipSessionValidation) return;
  getSession(sessionId, {
    workspace,
    codexHome: options.codexHome
  });
}

function normalizeStoredJob(job) {
  if (!job || typeof job !== "object" || !job.id || !job.sessionId || !job.prompt) return null;
  const repeat = job.repeat !== false;
  const intervalMinutes = repeat ? normalizeInterval(job.intervalMinutes || DEFAULT_INTERVAL_MINUTES) : null;
  return {
    id: String(job.id),
    name: normalizeName(job.name, job.prompt),
    workspace: normalizePath(job.workspace || process.cwd()),
    sessionId: String(job.sessionId),
    prompt: normalizePrompt(job.prompt),
    skills: normalizeSkills(job.skills),
    repeat,
    intervalMinutes,
    enabled: job.enabled !== false,
    nextRunAt: job.nextRunAt ? normalizeRunAt(job.nextRunAt, "nextRunAt") : null,
    lastRunAt: job.lastRunAt || null,
    lastResult: job.lastResult || null,
    runCount: Number(job.runCount || 0),
    createdAt: job.createdAt || nowIso(),
    updatedAt: job.updatedAt || job.createdAt || nowIso()
  };
}

function normalizeRequiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function normalizePrompt(value) {
  return normalizeRequiredString(value, "prompt");
}

function normalizeName(value, prompt) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (name) return name.slice(0, 120);
  return String(prompt || "Scheduled Codex task").replace(/\s+/g, " ").trim().slice(0, 80) || "Scheduled Codex task";
}

function normalizeSkills(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeInterval(value) {
  const minutes = Number(value === undefined || value === null || value === "" ? DEFAULT_INTERVAL_MINUTES : value);
  if (!Number.isFinite(minutes) || minutes < 1) throw new Error("intervalMinutes must be at least 1.");
  return Math.floor(minutes);
}

function normalizeRunAt(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return date.toISOString();
}

function defaultNextRunAt(intervalMinutes, now) {
  return new Date(new Date(now || Date.now()).getTime() + intervalMinutes * 60 * 1000).toISOString();
}

function nextIntervalRunAt(job, finishedAt) {
  const intervalMinutes = normalizeInterval(job.intervalMinutes || DEFAULT_INTERVAL_MINUTES);
  return new Date(new Date(finishedAt).getTime() + intervalMinutes * 60 * 1000).toISOString();
}

function normalizeRunResult(result, startedAt, finishedAt) {
  return {
    ok: result && result.code === 0,
    code: result ? result.code : null,
    signal: result ? result.signal || null : null,
    startedAt,
    finishedAt: nowIso(finishedAt),
    assistantText: result ? String(result.assistantText || "") : "",
    stderr: result ? String(result.stderr || "") : "",
    error: ""
  };
}

function compactRunResult(result) {
  return {
    ok: Boolean(result.ok),
    code: result.code,
    signal: result.signal || null,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    assistantText: compactText(result.assistantText),
    stderr: compactText(result.stderr),
    error: compactText(result.error)
  };
}

function compactText(value) {
  const text = String(value || "");
  return text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
}

function nowIso(now) {
  return new Date(now || Date.now()).toISOString();
}

module.exports = {
  bridgeHome,
  createJob,
  deleteJob,
  getJob,
  jobsFile,
  listJobs,
  readStore,
  runDueJobs,
  runJob,
  updateJob
};
