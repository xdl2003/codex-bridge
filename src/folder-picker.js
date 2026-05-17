"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

async function pickFolder() {
  if (process.platform === "win32") {
    return normalizePickedPath(await run("powershell.exe", powershellFolderArgs()));
  }

  if (process.platform === "darwin") {
    return normalizePickedPath(await run("osascript", ["-e", "POSIX path of (choose folder)"]));
  }

  if (isWsl()) {
    try {
      return normalizePickedPath(await run("powershell.exe", powershellFolderArgs()));
    } catch {
      // Fall through to Linux pickers.
    }
  }

  try {
    return normalizePickedPath(await run("zenity", ["--file-selection", "--directory"]));
  } catch {
    try {
      return normalizePickedPath(await run("kdialog", ["--getexistingdirectory"]));
    } catch {
      throw new Error("No native folder picker is available. Type the folder path manually.");
    }
  }
}

function powershellFolderArgs() {
  return [
    "-NoProfile",
    "-Command",
    [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$dialog.ShowNewFolderButton = $true;",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.WriteLine($dialog.SelectedPath)",
      "}"
    ].join(" ")
  ];
}

function isWsl() {
  return Boolean(process.env.WSL_DISTRO_NAME) || fs.existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

function normalizePickedPath(rawValue) {
  const value = String(rawValue || "").trim();
  const match = value.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return value;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`));
      }
    });
  });
}

module.exports = {
  pickFolder,
  normalizePickedPath
};
