# Codex Bridge

[中文文档](./README_CN.md)

Codex Bridge is a local CLI, HTTP API, and optional web UI for browsing and resuming Codex CLI sessions by workspace.

It is designed for people who use Codex across many local projects and want a lightweight way to:

- choose a local workspace
- see the Codex sessions recorded for that workspace
- inspect the conversation history
- resume a session through an API
- chat with the Codex agent from a browser
- reference local Codex skills with `$skill-name`

Codex Bridge is not an official OpenAI project. It wraps the local `codex` command and reads the local Codex session files on your machine.

## Features

- **Workspace-scoped session browser**  
  Lists Codex sessions for a selected workspace, matching the default `codex resume` user experience as closely as possible.

- **Conversation history API**  
  Reads local `~/.codex/sessions/**/*.jsonl` files and returns clean user/assistant history.

- **Resume and chat API**  
  Sends messages through `codex exec resume --json <session-id> -`, so the actual agent execution remains handled by the official Codex CLI.

- **Web UI**  
  Provides a local browser interface for selecting a workspace, selecting a session, reading history, and chatting with Codex.

- **Skill discovery**  
  Scans local Codex skill directories, including user skills, system skills, and plugin-provided skills.

- **Skill mention support**  
  Type `$` in the message box to insert a skill mention, or click a skill in the sidebar. The backend extracts `$skill-name` mentions and passes them to Codex as selected skills.

- **No runtime npm dependencies**  
  Uses only Node.js built-in modules.

## How It Works

Codex Bridge uses two different data paths:

1. **Session listing and history**
   - Reads local Codex JSONL session files from `~/.codex/sessions`.
   - Filters sessions by workspace/cwd.
   - Hides internal subagent sessions by default.

2. **Actual Codex execution**
   - Calls the local Codex CLI.
   - Uses `codex exec resume --json <session-id> -` for resumed conversations.
   - Uses `codex exec --json -C <workspace> -` for new conversations.

This means Codex Bridge does not reimplement the agent. It provides a local bridge around Codex CLI behavior.

## Requirements

- Node.js 18 or newer
- Codex CLI installed and authenticated
- A local `~/.codex/sessions` directory if you want to browse previous sessions

The project has no runtime npm package dependencies.

## Installation

Clone the repository:

```bash
git clone https://github.com/xdl2003/codex-bridge.git
cd codex-bridge
```

Run tests:

```bash
npm test
```

Start the interactive CLI:

```bash
npm start
```

Start the web/API server:

```bash
npm run server
```

The default local server address is:

```text
http://127.0.0.1:3977
```

## CLI Usage

Interactive mode:

```bash
node ./bin/codex-bridge.js
```

List sessions for a workspace:

```bash
node ./bin/codex-bridge.js sessions --workspace /path/to/project
```

Show one session's history:

```bash
node ./bin/codex-bridge.js history <session-id> --workspace /path/to/project
```

Resume a session and send a message:

```bash
node ./bin/codex-bridge.js chat <session-id> "Continue this task" --workspace /path/to/project
```

Start a new Codex session:

```bash
node ./bin/codex-bridge.js new "Inspect this project first" --workspace /path/to/project
```

Use an explicit skill from the CLI:

```bash
node ./bin/codex-bridge.js chat <session-id> "Plot this data" \
  --workspace /path/to/project \
  --skill plot-from-data
```

Open the selected session in the native Codex TUI:

```bash
node ./bin/codex-bridge.js tui <session-id> --workspace /path/to/project
```

## Web UI

Start the server:

```bash
npm run server
```

Open:

```text
http://127.0.0.1:3977
```

The web UI includes:

- workspace path input
- known workspace picker
- session list
- auto-scroll-to-bottom when a session is opened
- Markdown rendering for message history
- dedicated scroll area for the conversation panel
- skill search and `$skill-name` insertion
- chat composer that sends messages to the local Codex CLI

### Browser Folder Selection Limitation

Browsers do not reliably expose absolute local paths to web pages.

For example:

- `showDirectoryPicker()` exposes a directory handle and name, not a real absolute path.
- `<input webkitdirectory>` exposes relative paths, not a real absolute path.

Because Codex must run in a real local workspace path, Codex Bridge uses:

- manual path input
- known workspaces discovered from Codex sessions
- directory-name matching as a convenience when a browser directory picker is available

## Skill Support

Codex Bridge scans these local locations:

```text
~/.codex/skills
~/.codex/plugins/cache
~/.codex/.tmp/plugins/plugins/*/skills
~/.codex/.tmp/plugins/.agents/skills
```

The web UI shows the discovered skills in the sidebar.

You can use skills in two ways:

- type `$` in the message box and select a skill
- click a skill in the sidebar to insert it

Example:

```text
$plot-from-data draw a grouped bar chart from this CSV
```

When a message is sent, Codex Bridge extracts known `$skill-name` mentions and prepends a small instruction to the prompt so the resumed Codex process uses those skills.

## HTTP API

Health check:

```http
GET /api/health
```

List known workspaces:

```http
GET /api/workspaces
```

List local skills:

```http
GET /api/skills
```

List sessions for a workspace:

```http
GET /api/sessions?workspace=/path/to/project
```

Fetch session history:

```http
GET /api/sessions/:id/history?workspace=/path/to/project
```

Send a message to a resumed session:

```http
POST /api/sessions/:id/chat
```

Example request body:

```json
{
  "workspace": "/path/to/project",
  "skills": ["plot-from-data"],
  "message": "$plot-from-data draw this dataset"
}
```

Start a new session:

```http
POST /api/sessions/new
```

Stream a resumed chat response:

```http
POST /api/sessions/:id/chat/stream
```

## Project Structure

```text
bin/
  codex-bridge.js       CLI entry point
public/
  index.html            Web UI shell
  app.js                Browser application logic
  styles.css            Web UI styles
src/
  api-server.js         Local HTTP API and static file server
  cli.js                CLI commands and interactive mode
  codex-runner.js       Codex CLI process wrapper
  folder-picker.js      Optional folder picker helpers
  session-store.js      Codex JSONL session parsing
  skill-store.js        Local skill discovery and prompt injection
test/
  session-store.test.js Unit tests
fixtures/
  fake-codex.js         Fake Codex binary for local development
```

## Privacy and Security

Codex Bridge is intended to run locally.

- The web server binds to `127.0.0.1` by default.
- Session history is read from local Codex session files.
- Chat execution is delegated to the local Codex CLI.
- No telemetry or external service calls are implemented by Codex Bridge itself.

Be careful when exposing the HTTP server beyond localhost. The API can read local Codex history and can start Codex runs in local workspaces.

## Development

Run tests:

```bash
npm test
```

Run syntax checks manually:

```bash
node --check public/app.js
node --check src/api-server.js
node --check src/cli.js
node --check src/codex-runner.js
node --check src/session-store.js
node --check src/skill-store.js
```

## License

MIT License. See [LICENSE](./LICENSE).
