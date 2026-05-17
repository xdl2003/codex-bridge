"use strict";

const state = {
  workspace: localStorage.getItem("codexBridge.workspace") || "",
  workspaces: [],
  skills: [],
  skillSuggestOpen: false,
  activeSkillIndex: 0,
  sessions: [],
  session: null,
  jobs: [],
  taskFormOpen: false,
  promptTarget: "message",
  busy: false,
  pickerOpen: false
};

const els = {
  status: document.getElementById("status"),
  workspace: document.getElementById("workspace"),
  pickFolder: document.getElementById("pick-folder"),
  folderInput: document.getElementById("folder-input"),
  workspacePicker: document.getElementById("workspace-picker"),
  closePicker: document.getElementById("close-picker"),
  workspaces: document.getElementById("workspaces"),
  scan: document.getElementById("scan"),
  refresh: document.getElementById("refresh"),
  skillFilter: document.getElementById("skill-filter"),
  skills: document.getElementById("skills"),
  skillsCount: document.getElementById("skills-count"),
  jobsRefresh: document.getElementById("jobs-refresh"),
  taskToggle: document.getElementById("task-toggle"),
  taskForm: document.getElementById("task-form"),
  taskName: document.getElementById("task-name"),
  taskPrompt: document.getElementById("task-prompt"),
  taskInterval: document.getElementById("task-interval"),
  taskNext: document.getElementById("task-next"),
  taskRepeat: document.getElementById("task-repeat"),
  createTask: document.getElementById("create-task"),
  tasks: document.getElementById("tasks"),
  sessions: document.getElementById("sessions"),
  newSession: document.getElementById("new-session"),
  sessionTitle: document.getElementById("session-title"),
  sessionMeta: document.getElementById("session-meta"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  message: document.getElementById("message"),
  skillSuggest: document.getElementById("skill-suggest"),
  send: document.getElementById("send")
};

init();

function init() {
  els.workspace.value = state.workspace;
  els.scan.addEventListener("click", scanSessions);
  els.refresh.addEventListener("click", scanSessions);
  els.pickFolder.addEventListener("click", browseWorkspace);
  els.closePicker.addEventListener("click", closeWorkspacePicker);
  els.skillFilter.addEventListener("input", renderSkills);
  els.jobsRefresh.addEventListener("click", loadJobs);
  els.taskToggle.addEventListener("click", toggleTaskForm);
  els.taskForm.addEventListener("submit", createTask);
  els.newSession.addEventListener("click", newSession);
  els.composer.addEventListener("submit", sendMessage);
  els.message.addEventListener("focus", () => {
    state.promptTarget = "message";
  });
  els.message.addEventListener("input", updateSkillSuggest);
  els.message.addEventListener("keydown", handleComposerKeydown);
  els.message.addEventListener("blur", () => window.setTimeout(closeSkillSuggest, 120));
  els.taskPrompt.addEventListener("focus", () => {
    state.promptTarget = "taskPrompt";
    closeSkillSuggest();
  });
  setDefaultTaskRunAt();
  renderTaskForm();
  renderMessages([]);
  bootstrap();
  window.setInterval(loadJobs, 15000);
}

async function scanSessions() {
  const workspace = els.workspace.value.trim();
  setStatus("Scanning");
  try {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
    const data = await request(`/api/sessions${query}`);
    state.workspace = workspace;
    localStorage.setItem("codexBridge.workspace", workspace);
    state.sessions = data.sessions || [];
    renderSessions();
    await loadJobs();
    setStatus(`${state.sessions.length} sessions`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function bootstrap() {
  try {
    const health = await request("/api/health");
    if (!els.workspace.value.trim() && health.defaultWorkspace) {
      els.workspace.value = health.defaultWorkspace;
    }
    await loadWorkspaces();
    await loadSkills();
    await loadJobs();
    if (els.workspace.value.trim()) await scanSessions();
  } catch (error) {
    setStatus(error.message);
  }
}

async function toggleWorkspacePicker() {
  if (state.pickerOpen) {
    closeWorkspacePicker();
    return;
  }
  setStatus("Loading workspaces");
  await loadWorkspaces();
  state.pickerOpen = true;
  els.workspacePicker.hidden = false;
  setStatus(state.workspaces.length ? "Choose a workspace" : "Type a path manually");
}

async function browseWorkspace() {
  if (state.pickerOpen) {
    closeWorkspacePicker();
    return;
  }

  try {
    await loadWorkspaces();
    const pickedName = await pickDirectoryName();
    if (!pickedName) {
      await toggleWorkspacePicker();
      return;
    }

    const matches = state.workspaces.filter((workspace) => basename(workspace.path) === pickedName);
    if (matches.length === 1) {
      els.workspace.value = matches[0].path;
      closeWorkspacePicker();
      await scanSessions();
      return;
    }

    state.pickerOpen = true;
    els.workspacePicker.hidden = false;
    setStatus(
      matches.length
        ? `Multiple paths named ${pickedName}; choose one`
        : `Selected ${pickedName}; browser hid its absolute path`
    );
  } catch (error) {
    setStatus(error.message);
    state.pickerOpen = true;
    els.workspacePicker.hidden = false;
  }
}

async function pickDirectoryName() {
  if (window.showDirectoryPicker) {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    return handle && handle.name ? handle.name : "";
  }

  if (els.folderInput && "webkitdirectory" in els.folderInput) {
    els.folderInput.value = "";
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(""), 1000);
      els.folderInput.onchange = () => {
        window.clearTimeout(timeout);
        resolve(directoryNameFromFileInput());
      };
      els.folderInput.click();
    });
  }

  return "";
}

function directoryNameFromFileInput() {
  const first = els.folderInput.files && els.folderInput.files[0];
  if (!first || !first.webkitRelativePath) return "";
  return first.webkitRelativePath.split("/")[0] || "";
}

function closeWorkspacePicker() {
  state.pickerOpen = false;
  els.workspacePicker.hidden = true;
}

async function loadWorkspaces() {
  const data = await request("/api/workspaces");
  state.workspaces = data.workspaces || [];
  renderWorkspaces();
}

async function loadSkills() {
  const data = await request("/api/skills");
  state.skills = data.skills || [];
  renderSkills();
}

async function loadJobs() {
  try {
    const workspace = els.workspace.value.trim();
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
    const data = await request(`/api/jobs${query}`);
    state.jobs = data.jobs || [];
    renderJobs();
  } catch (error) {
    setStatus(error.message);
  }
}

async function selectSession(sessionId) {
  setStatus("Loading history");
  const workspace = els.workspace.value.trim();
  const data = await request(`/api/sessions/${encodeURIComponent(sessionId)}/history?workspace=${encodeURIComponent(workspace)}`);
  state.session = data.session;
  renderSessions();
  renderSelectedSession();
  renderMessages(state.session.messages || [], true);
  renderJobs();
  renderTaskForm();
  setStatus("Ready");
}

function toggleTaskForm() {
  if (!state.session) {
    setStatus("Select a session first");
    return;
  }

  state.taskFormOpen = !state.taskFormOpen;
  if (state.taskFormOpen && !els.taskNext.value) setDefaultTaskRunAt();
  renderTaskForm();
  if (state.taskFormOpen) requestAnimationFrame(() => els.taskPrompt.focus());
}

async function createTask(event) {
  event.preventDefault();
  if (!state.session) {
    setStatus("Select a session first");
    return;
  }

  const prompt = els.taskPrompt.value.trim();
  if (!prompt) {
    setStatus("Prompt is required");
    return;
  }

  try {
    const data = await request("/api/jobs", {
      method: "POST",
      body: {
        workspace: els.workspace.value.trim(),
        sessionId: state.session.id,
        name: els.taskName.value.trim(),
        prompt,
        skills: skillIdsFromMessage(prompt),
        intervalMinutes: Number(els.taskInterval.value || 60),
        nextRunAt: datetimeLocalToIso(els.taskNext.value),
        repeat: els.taskRepeat.checked,
        enabled: true
      }
    });
    state.jobs = [data.job, ...state.jobs.filter((job) => job.id !== data.job.id)];
    els.taskName.value = "";
    els.taskPrompt.value = "";
    setDefaultTaskRunAt();
    state.taskFormOpen = false;
    renderTaskForm();
    renderJobs();
    setStatus("Task scheduled");
  } catch (error) {
    setStatus(error.message);
  }
}

async function runTask(jobId) {
  try {
    setStatus("Running task");
    const data = await request(`/api/jobs/${encodeURIComponent(jobId)}/run`, { method: "POST" });
    replaceJob(data.job);
    setStatus(data.result && data.result.ok ? "Task finished" : "Task exited with an error");
  } catch (error) {
    setStatus(error.message);
    await loadJobs();
  }
}

async function toggleTask(job) {
  try {
    const data = await request(`/api/jobs/${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      body: { enabled: !job.enabled }
    });
    replaceJob(data.job);
    setStatus(data.job.enabled ? "Task resumed" : "Task paused");
  } catch (error) {
    setStatus(error.message);
  }
}

async function deleteTask(jobId) {
  if (!window.confirm("Delete this task?")) return;
  try {
    await request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    state.jobs = state.jobs.filter((job) => job.id !== jobId);
    renderJobs();
    setStatus("Task deleted");
  } catch (error) {
    setStatus(error.message);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.session || state.busy) return;
  const message = els.message.value.trim();
  if (!message) return;

  els.message.value = "";
  state.session.messages = state.session.messages || [];
  state.session.messages.push({
    role: "user",
    text: message,
    timestamp: new Date().toISOString()
  });
  renderMessages(state.session.messages, true);
  setBusy(true, "Running Codex");

  try {
    const data = await request(`/api/sessions/${encodeURIComponent(state.session.id)}/chat`, {
      method: "POST",
      body: {
        workspace: els.workspace.value.trim(),
        skills: skillIdsFromMessage(message),
        message
      }
    });
    if (data.session) {
      state.session = data.session;
      renderMessages(state.session.messages || [], true);
    } else if (data.result && data.result.assistantText) {
      state.session.messages.push({
        role: "assistant",
        text: data.result.assistantText,
        timestamp: new Date().toISOString()
      });
      renderMessages(state.session.messages, true);
    }
    setStatus(data.ok ? "Ready" : "Codex exited with an error");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function newSession() {
  if (state.busy) return;
  const message = window.prompt("Initial message");
  if (!message || !message.trim()) return;

  setBusy(true, "Starting session");
  try {
    const data = await request("/api/sessions/new", {
      method: "POST",
      body: {
        workspace: els.workspace.value.trim(),
        skills: skillIdsFromMessage(message),
        message: message.trim()
      }
    });
    await scanSessions();
    if (data.session) await selectSession(data.session.id);
    setStatus(data.ok ? "Ready" : "Codex exited with an error");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function renderSessions() {
  els.sessions.innerHTML = "";
  for (const session of state.sessions) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.session && state.session.id === session.id ? "active" : "";
    button.addEventListener("click", () => selectSession(session.id));

    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = session.title;

    const id = document.createElement("span");
    id.className = "session-id";
    id.textContent = `${formatDate(session.timestamp || session.lastEventAt)} · ${session.id}`;

    button.append(title, id);
    item.appendChild(button);
    els.sessions.appendChild(item);
  }
}

function renderWorkspaces() {
  els.workspaces.innerHTML = "";
  if (!state.workspaces.length) {
    const item = document.createElement("li");
    item.className = "workspace-empty";
    item.textContent = "No previous Codex workspaces found";
    els.workspaces.appendChild(item);
    return;
  }

  for (const workspace of state.workspaces) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", async () => {
      els.workspace.value = workspace.path;
      closeWorkspacePicker();
      await scanSessions();
    });

    const path = document.createElement("span");
    path.className = "workspace-path";
    path.textContent = workspace.path;

    const meta = document.createElement("span");
    meta.className = "workspace-meta";
    meta.textContent = `${workspace.sessionCount} sessions · ${formatDate(workspace.latestAt)}`;

    button.append(path, meta);
    item.appendChild(button);
    els.workspaces.appendChild(item);
  }
}

function renderSkills() {
  els.skills.innerHTML = "";
  const filter = els.skillFilter.value.trim().toLowerCase();
  const visible = state.skills.filter((skill) => {
    if (!filter) return true;
    return [skill.id, skill.title, skill.description, skill.source]
      .join(" ")
      .toLowerCase()
      .includes(filter);
  });

  for (const skill of visible) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skill-item";
    button.addEventListener("click", () => insertSkillMention(skill.id));

    const body = document.createElement("span");
    body.className = "skill-body";

    const name = document.createElement("span");
    name.className = "skill-name";
    name.textContent = skill.id;

    const meta = document.createElement("span");
    meta.className = "skill-meta";
    meta.textContent = `${skill.source}${skill.description ? ` · ${skill.description}` : ""}`;

    body.append(name, meta);
    button.appendChild(body);
    item.appendChild(button);
    els.skills.appendChild(item);
  }

  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "skill-empty";
    empty.textContent = state.skills.length ? "No matching skills" : "No skills found";
    els.skills.appendChild(empty);
  }

  updateSkillsCount(visible.length);
}

function updateSkillsCount(visibleCount) {
  const total = state.skills.length;
  els.skillsCount.textContent = visibleCount === total ? `${total} available` : `${visibleCount}/${total}`;
}

function renderJobs() {
  els.tasks.innerHTML = "";
  els.createTask.disabled = state.busy || !state.session;

  const jobs = state.jobs || [];
  if (!jobs.length) {
    const empty = document.createElement("li");
    empty.className = "task-empty";
    empty.textContent = "No scheduled tasks";
    els.tasks.appendChild(empty);
    return;
  }

  for (const job of jobs) {
    const item = document.createElement("li");
    const active = state.session && state.session.id === job.sessionId;
    item.className = active ? "task-card active" : "task-card";

    const head = document.createElement("div");
    head.className = "task-head";

    const title = document.createElement("span");
    title.className = "task-name";
    title.textContent = job.name;

    const stateLabel = document.createElement("span");
    stateLabel.className = job.running ? "task-state running" : job.enabled ? "task-state" : "task-state paused";
    stateLabel.textContent = job.running ? "Running" : job.enabled ? "On" : "Paused";

    head.append(title, stateLabel);

    const meta = document.createElement("p");
    meta.className = "task-meta";
    const repeat = job.repeat ? `every ${job.intervalMinutes}m` : "once";
    meta.textContent = `${repeat} · next ${formatDate(job.nextRunAt)} · ${job.sessionId}`;

    const prompt = document.createElement("p");
    prompt.className = "task-prompt";
    prompt.textContent = job.prompt;

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const run = document.createElement("button");
    run.type = "button";
    run.textContent = "Run";
    run.disabled = job.running;
    run.addEventListener("click", () => runTask(job.id));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = job.enabled ? "Pause" : "Resume";
    toggle.disabled = job.running;
    toggle.addEventListener("click", () => toggleTask(job));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.disabled = job.running;
    remove.addEventListener("click", () => deleteTask(job.id));

    actions.append(run, toggle, remove);
    item.append(head, meta, prompt, actions);
    els.tasks.appendChild(item);
  }
}

function replaceJob(job) {
  state.jobs = [job].concat(state.jobs.filter((candidate) => candidate.id !== job.id));
  renderJobs();
}

function renderTaskForm() {
  els.taskForm.hidden = !state.taskFormOpen;
  els.taskToggle.textContent = state.taskFormOpen ? "Cancel" : "New Task";
  els.taskToggle.disabled = state.busy || !state.session;
  els.createTask.disabled = state.busy || !state.session;
}

function skillIdsFromMessage(message) {
  const known = new Set(state.skills.map((skill) => skill.id));
  const ids = [];
  for (const match of String(message || "").matchAll(/\$([A-Za-z0-9:_-]+)/g)) {
    if (known.has(match[1]) && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

function updateSkillSuggest() {
  const mention = currentSkillMention();
  if (!mention) {
    closeSkillSuggest();
    return;
  }
  state.activeSkillIndex = 0;
  renderSkillSuggest(mention.query);
}

function renderSkillSuggest(query) {
  const q = String(query || "").toLowerCase();
  const suggestions = state.skills
    .filter((skill) => {
      if (!q) return true;
      return [skill.id, skill.title, skill.description].join(" ").toLowerCase().includes(q);
    })
    .slice(0, 12);

  els.skillSuggest.innerHTML = "";
  if (!suggestions.length) {
    closeSkillSuggest();
    return;
  }

  suggestions.forEach((skill, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === state.activeSkillIndex ? "active" : "";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      replaceCurrentSkillMention(skill.id);
    });

    const name = document.createElement("span");
    name.className = "skill-name";
    name.textContent = `$${skill.id}`;

    const meta = document.createElement("span");
    meta.className = "skill-meta";
    meta.textContent = skill.description || skill.source;

    button.append(name, meta);
    item.appendChild(button);
    els.skillSuggest.appendChild(item);
  });

  state.skillSuggestOpen = true;
  els.skillSuggest.hidden = false;
}

function handleComposerKeydown(event) {
  if (!state.skillSuggestOpen) return;
  const buttons = Array.from(els.skillSuggest.querySelectorAll("button"));
  if (!buttons.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.activeSkillIndex = (state.activeSkillIndex + 1) % buttons.length;
    refreshSuggestActive(buttons);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.activeSkillIndex = (state.activeSkillIndex - 1 + buttons.length) % buttons.length;
    refreshSuggestActive(buttons);
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    buttons[state.activeSkillIndex].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  } else if (event.key === "Escape") {
    closeSkillSuggest();
  }
}

function refreshSuggestActive(buttons) {
  buttons.forEach((button, index) => {
    button.className = index === state.activeSkillIndex ? "active" : "";
  });
}

function closeSkillSuggest() {
  state.skillSuggestOpen = false;
  els.skillSuggest.hidden = true;
  els.skillSuggest.innerHTML = "";
}

function insertSkillMention(skillId) {
  const target = activePromptElement();
  const prefix = target.value && !/\s$/.test(target.value) ? " " : "";
  const insertion = `${prefix}$${skillId} `;
  const start = target.selectionStart || target.value.length;
  const end = target.selectionEnd || start;
  target.value = `${target.value.slice(0, start)}${insertion}${target.value.slice(end)}`;
  const cursor = start + insertion.length;
  target.focus();
  target.setSelectionRange(cursor, cursor);
  closeSkillSuggest();
}

function replaceCurrentSkillMention(skillId) {
  const mention = currentSkillMention();
  if (!mention) {
    insertSkillMention(skillId);
    return;
  }
  const insertion = `$${skillId} `;
  els.message.value = `${els.message.value.slice(0, mention.start)}${insertion}${els.message.value.slice(mention.end)}`;
  const cursor = mention.start + insertion.length;
  els.message.focus();
  els.message.setSelectionRange(cursor, cursor);
  closeSkillSuggest();
}

function currentSkillMention() {
  const cursor = els.message.selectionStart || 0;
  const before = els.message.value.slice(0, cursor);
  const match = before.match(/(^|\s)\$([A-Za-z0-9:_-]*)$/);
  if (!match) return null;
  const start = cursor - match[2].length - 1;
  return {
    start,
    end: cursor,
    query: match[2]
  };
}

function activePromptElement() {
  return state.promptTarget === "taskPrompt" ? els.taskPrompt : els.message;
}

function renderSelectedSession() {
  if (!state.session) {
    els.sessionTitle.textContent = "No session selected";
    els.sessionMeta.textContent = "";
    return;
  }
  els.sessionTitle.textContent = state.session.title;
  els.sessionMeta.textContent = `${state.session.id} · ${state.session.cwd || ""}`;
}

function renderMessages(messages, scrollBottom) {
  els.messages.innerHTML = "";
  const visible = (messages || []).filter((message) => ["user", "assistant"].includes(message.role));
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Select a session";
    els.messages.appendChild(empty);
    return;
  }

  for (const message of visible) {
    const node = document.createElement("article");
    node.className = `message ${message.role}`;

    const role = document.createElement("div");
    role.className = "role";
    role.textContent = message.phase ? `${message.role}:${message.phase}` : message.role;

    const text = document.createElement("div");
    text.className = "markdown";
    text.innerHTML = markdownToHtml(message.text || "");

    node.append(role, text);
    els.messages.appendChild(node);
  }

  if (scrollBottom) {
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }
}

function markdownToHtml(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listItems = [];
  let listType = "";
  let codeLines = [];
  let inCode = false;
  let codeLang = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === "ol" ? "ol" : "ul";
    html.push(`<${tag}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    listItems = [];
    listType = "";
  };

  const flushCode = () => {
    const lang = codeLang ? ` data-lang="${escapeAttribute(codeLang)}"` : "";
    html.push(`<pre class="code-block"${lang}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    codeLang = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```([\w.-]*)\s*$/);
    if (fence) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = fence[1] || "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      flushParagraph();
      flushList();
      const table = consumeTable(lines, index);
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();

  return html.join("");
}

function inlineMarkdown(source) {
  const codeTokens = [];
  const withTokens = String(source || "").replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${codeTokens.length}@@`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  let html = escapeHtml(withTokens);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
  html = html.replace(/\b\*([^*]+)\*\b/g, "<em>$1</em>");

  return html.replace(/@@CODE(\d+)@@/g, (_, index) => codeTokens[Number(index)] || "");
}

function isMarkdownTable(lines, index) {
  return Boolean(
    lines[index] &&
      lines[index].includes("|") &&
      lines[index + 1] &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function consumeTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  const rows = [];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const head = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");
  return {
    html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    nextIndex: index
  };
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function request(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    }
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function setBusy(value, label) {
  state.busy = value;
  els.send.disabled = value || !state.session;
  els.scan.disabled = value;
  els.refresh.disabled = value;
  els.newSession.disabled = value;
  els.taskToggle.disabled = value || !state.session;
  els.createTask.disabled = value || !state.session;
  if (label) setStatus(label);
}

function setStatus(value) {
  els.status.textContent = value;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setDefaultTaskRunAt() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  els.taskNext.value = toDatetimeLocal(date);
}

function datetimeLocalToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDatetimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes())
  ].join("");
}

function basename(inputPath) {
  return String(inputPath || "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();
}
