# Codex Bridge

[English README](./README.md)

Codex Bridge 是一个本地 CLI、HTTP API 和可选网页界面，用来按工作目录浏览和恢复 Codex CLI 会话。

它适合经常在多个本地项目之间使用 Codex 的用户，核心目标是：

- 选择本地 workspace
- 查看该 workspace 下的 Codex 历史会话
- 读取会话历史消息
- 通过 API 恢复会话并发送消息
- 在浏览器里和 Codex agent 聊天
- 使用 `$skill-name` 引用本机 Codex skills

Codex Bridge 不是 OpenAI 官方项目。它只是封装本机 `codex` 命令，并读取本机 Codex session 文件。

## 功能特性

- **按 workspace 浏览会话**  
  根据选中的工作目录列出对应 Codex 会话，尽量贴近 `codex resume` 默认 picker 的用户视角。

- **会话历史 API**  
  读取本机 `~/.codex/sessions/**/*.jsonl`，提取用户和 assistant 的可读历史消息。

- **恢复会话并对话**  
  通过 `codex exec resume --json <session-id> -` 发送消息，实际 agent 执行仍由官方 Codex CLI 负责。

- **网页界面**  
  提供本地浏览器界面，用于选择 workspace、选择会话、阅读历史、发送消息。

- **Skill 发现**  
  扫描本机用户 skill、系统 skill，以及插件提供的 skills。

- **Skill mention 支持**  
  在输入框输入 `$` 可插入 skill mention，也可以点击左侧 skill 列表插入。后端会提取 `$skill-name` 并传给 Codex。

- **无运行时 npm 依赖**  
  只使用 Node.js 内置模块。

## 工作原理

Codex Bridge 使用两条数据路径：

1. **会话列表和历史**
   - 读取本机 Codex JSONL session 文件：`~/.codex/sessions`
   - 按 workspace/cwd 过滤会话
   - 默认隐藏内部 subagent 会话

2. **真正执行 Codex**
   - 调用本机 Codex CLI
   - 恢复会话使用：`codex exec resume --json <session-id> -`
   - 新建会话使用：`codex exec --json -C <workspace> -`

也就是说，Codex Bridge 不重新实现 agent，只是在 Codex CLI 外面提供一个本地桥接层。

## 环境要求

- Node.js 18 或更新版本
- 已安装并登录 Codex CLI
- 如果需要浏览历史会话，需要本机存在 `~/.codex/sessions`

项目没有运行时 npm package 依赖。

## 安装

克隆仓库：

```bash
git clone https://github.com/xdl2003/codex-bridge.git
cd codex-bridge
```

运行测试：

```bash
npm test
```

启动交互式 CLI：

```bash
npm start
```

启动网页/API 服务：

```bash
npm run server
```

默认本地服务地址：

```text
http://127.0.0.1:3977
```

## CLI 使用

交互模式：

```bash
node ./bin/codex-bridge.js
```

列出某个 workspace 的会话：

```bash
node ./bin/codex-bridge.js sessions --workspace /path/to/project
```

查看指定会话历史：

```bash
node ./bin/codex-bridge.js history <session-id> --workspace /path/to/project
```

恢复会话并发送消息：

```bash
node ./bin/codex-bridge.js chat <session-id> "继续这个任务" --workspace /path/to/project
```

新建 Codex 会话：

```bash
node ./bin/codex-bridge.js new "先检查这个项目" --workspace /path/to/project
```

在 CLI 中显式使用 skill：

```bash
node ./bin/codex-bridge.js chat <session-id> "把这些数据画成图" \
  --workspace /path/to/project \
  --skill plot-from-data
```

打开原生 Codex TUI：

```bash
node ./bin/codex-bridge.js tui <session-id> --workspace /path/to/project
```

## 网页界面

启动服务：

```bash
npm run server
```

打开：

```text
http://127.0.0.1:3977
```

网页界面包含：

- workspace 路径输入框
- 已知 workspace 选择器
- 会话列表
- 打开会话后自动滚动到消息底部
- 消息历史 Markdown 渲染
- 对话区域独立滚动，不撑大整个页面
- skill 搜索和 `$skill-name` 插入
- 发送消息给本机 Codex CLI 的聊天输入框

### 浏览器选择文件夹的限制

浏览器网页无法稳定获取绝对本地路径。

例如：

- `showDirectoryPicker()` 只暴露目录 handle 和目录名，不暴露真实绝对路径
- `<input webkitdirectory>` 只暴露相对路径，不暴露真实绝对路径

而 Codex 必须在真实本地 workspace 路径中运行，所以 Codex Bridge 使用：

- 手动输入绝对路径
- 从 Codex 历史会话中发现已知 workspace
- 在浏览器目录选择器可用时，用目录名匹配已知 workspace

## Skill 支持

Codex Bridge 会扫描这些本地位置：

```text
~/.codex/skills
~/.codex/plugins/cache
~/.codex/.tmp/plugins/plugins/*/skills
~/.codex/.tmp/plugins/.agents/skills
```

网页左侧会显示发现到的 skills。

使用方式：

- 在消息框输入 `$` 并选择 skill
- 点击左侧 skill 列表，把 skill mention 插入输入框

示例：

```text
$plot-from-data 用这个 CSV 画一个 grouped bar chart
```

发送消息时，Codex Bridge 会提取已知 `$skill-name`，并在 prompt 前面追加一小段说明，让恢复后的 Codex 进程使用这些 skills。

## HTTP API

健康检查：

```http
GET /api/health
```

列出已知 workspaces：

```http
GET /api/workspaces
```

列出本机 skills：

```http
GET /api/skills
```

列出某个 workspace 的会话：

```http
GET /api/sessions?workspace=/path/to/project
```

获取会话历史：

```http
GET /api/sessions/:id/history?workspace=/path/to/project
```

给恢复后的会话发送消息：

```http
POST /api/sessions/:id/chat
```

请求体示例：

```json
{
  "workspace": "/path/to/project",
  "skills": ["plot-from-data"],
  "message": "$plot-from-data 画这个数据集"
}
```

新建会话：

```http
POST /api/sessions/new
```

流式恢复会话并聊天：

```http
POST /api/sessions/:id/chat/stream
```

## 项目结构

```text
bin/
  codex-bridge.js       CLI 入口
public/
  index.html            网页 UI 外壳
  app.js                浏览器端应用逻辑
  styles.css            网页样式
src/
  api-server.js         本地 HTTP API 和静态文件服务
  cli.js                CLI 命令和交互模式
  codex-runner.js       Codex CLI 子进程封装
  folder-picker.js      可选文件夹选择辅助逻辑
  session-store.js      Codex JSONL session 解析
  skill-store.js        本地 skill 发现和 prompt 注入
test/
  session-store.test.js 单元测试
fixtures/
  fake-codex.js         本地开发用 fake Codex binary
```

## 隐私和安全

Codex Bridge 设计为本地运行。

- Web 服务默认绑定到 `127.0.0.1`
- 会话历史来自本机 Codex session 文件
- 聊天执行交给本机 Codex CLI
- Codex Bridge 本身没有 telemetry，也不会主动调用外部服务

不要随意把 HTTP 服务暴露到公网或不可信网络。API 可以读取本机 Codex 历史，也可以在本地 workspace 中启动 Codex。

## 开发

运行测试：

```bash
npm test
```

手动语法检查：

```bash
node --check public/app.js
node --check src/api-server.js
node --check src/cli.js
node --check src/codex-runner.js
node --check src/session-store.js
node --check src/skill-store.js
```

## 许可证

MIT License。见 [LICENSE](./LICENSE)。
