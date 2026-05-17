"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function listSkills(options = {}) {
  const home = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const roots = [
    path.join(home, "skills"),
    path.join(home, "plugins", "cache"),
    path.join(home, ".tmp", "plugins", "plugins"),
    path.join(home, ".tmp", "plugins", ".agents", "skills")
  ];
  const files = Array.from(new Set(roots.flatMap((root) => findSkillFiles(root))));

  const byId = new Map();
  for (const filePath of files) {
    const skill = parseSkillFile(filePath, home);
    if (!skill || byId.has(skill.id)) continue;
    byId.set(skill.id, skill);
  }

  return Array.from(byId.values()).sort((a, b) => {
    const sourceSort = sourceWeight(a.source) - sourceWeight(b.source);
    if (sourceSort !== 0) return sourceSort;
    return a.id.localeCompare(b.id);
  });
}

function findSkillFiles(root) {
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
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function findPluginSkillFiles(root) {
  return findSkillFiles(root).filter((filePath) => filePath.includes(`${path.sep}skills${path.sep}`));
}

function parseSkillFile(filePath, codexHome) {
  let contents = "";
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const metadata = parseFrontmatter(contents);
  const name = metadata.name || path.basename(path.dirname(filePath));
  const plugin = pluginName(filePath);
  const id = plugin ? `${plugin}:${name}` : name;
  const source = sourceFor(filePath, codexHome, plugin);
  const title = firstMarkdownHeading(contents) || name;

  return {
    id,
    name,
    title,
    description: metadata.description || firstParagraph(contents) || "",
    source,
    plugin,
    path: filePath
  };
}

function parseFrontmatter(contents) {
  if (!contents.startsWith("---")) return {};
  const end = contents.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = contents.slice(3, end).split(/\r?\n/);
  const result = {};

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    const scalar = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!scalar) continue;

    const key = scalar[1];
    let value = scalar[2].trim();
    if (value === "|" || value === ">") {
      const lines = [];
      index += 1;
      while (index < block.length && /^\s+/.test(block[index])) {
        lines.push(block[index].replace(/^\s{2}/, ""));
        index += 1;
      }
      index -= 1;
      result[key] = lines.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }

    result[key] = stripQuotes(value);
  }

  return result;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function firstMarkdownHeading(contents) {
  const match = contents.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function firstParagraph(contents) {
  const body = contents.replace(/^---[\s\S]*?\n---\s*/, "");
  const paragraph = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("#"));
  return paragraph ? paragraph.replace(/\s+/g, " ").slice(0, 240) : "";
}

function pluginName(filePath) {
  const parts = filePath.split(path.sep);

  const cacheIndex = parts.lastIndexOf("cache");
  if (cacheIndex !== -1) {
    const marketplace = parts[cacheIndex + 1];
    const plugin = parts[cacheIndex + 2];
    return marketplace && plugin ? plugin : null;
  }

  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] === "plugins" && parts[index + 1] === "plugins") {
      return parts[index + 2] || null;
    }
  }

  return null;
}

function sourceFor(filePath, codexHome, plugin) {
  if (plugin) return "plugin";
  const systemRoot = path.join(codexHome, "skills", ".system");
  if (filePath.startsWith(systemRoot)) return "system";
  return "user";
}

function sourceWeight(source) {
  if (source === "user") return 0;
  if (source === "plugin") return 1;
  return 2;
}

function buildSkillPrompt(message, skillIds) {
  const selected = Array.from(new Set((skillIds || []).map(String).map((id) => id.trim()).filter(Boolean)));
  if (!selected.length) return message;
  const names = selected.map((id) => `$${id}`).join(", ");
  return [
    `Use these Codex skills for this request: ${names}.`,
    "Follow each selected skill's SKILL.md workflow when it applies.",
    "",
    message
  ].join("\n");
}

module.exports = {
  buildSkillPrompt,
  listSkills,
  parseFrontmatter,
  parseSkillFile
};
