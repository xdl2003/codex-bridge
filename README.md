# Codex Bridge

Codex Bridge 是一个本地 CLI/API/网页壳，用来按工作目录查看并恢复 Codex CLI 会话。

核心策略很简单：

- 会话列表和历史消息直接解析本机 `~/.codex/sessions/**/*.jsonl`
- 默认复刻 `codex resume` 的用户视角过滤：按 workspace/cwd 筛选，并隐藏内部 subagent 会话
- 续聊调用官方 CLI：`codex exec resume --json <session-id> -`
- 网页只连接本机 HTTP 服务，不把会话历史发到第三方服务
- 没有 npm 运行时依赖，Node.js 18+ 即可

## 使用

```bash
npm start
```

交互模式会先选择目标文件夹，然后列出该文件夹下的 Codex 历史会话。选中会话后可以直接在 CLI 里继续对话。

常用命令：

```bash
node ./bin/codex-bridge.js sessions --workspace /path/to/project
node ./bin/codex-bridge.js history <session-id> --workspace /path/to/project
node ./bin/codex-bridge.js chat <session-id> "继续实现这个功能" --workspace /path/to/project --skill plot-from-data
node ./bin/codex-bridge.js new "先看一下这个项目" --workspace /path/to/project --skill github:github
node ./bin/codex-bridge.js tui <session-id> --workspace /path/to/project
```

## Web/API

```bash
npm run server
```

默认地址是 `http://127.0.0.1:3977`。

网页支持输入工作目录、扫描会话、点击会话、查看历史、发送消息给 Codex。打开会话时会自动定位到历史消息底部。`Browse` 是前端目录选择组件加已知 workspace 列表：浏览器可以打开目录选择器，但普通网页拿不到绝对本地路径，所以它会用目录名匹配已有 Codex workspace；匹配不到时需要直接输入绝对路径。

网页左侧会显示本机可用 skills，可搜索、点击插入。也可以直接在消息框输入 `$` 弹出 skill 候选，选择后会插入 `$skill-name`，例如 `$plot-from-data` 或 `$github:github`。发送消息时，页面会从消息文本里自动提取这些 `$skill-name` 并传给后端。

## HTTP API

```http
GET  /api/workspaces
GET  /api/skills
GET  /api/sessions?workspace=/path/to/project
GET  /api/sessions/:id/history?workspace=/path/to/project
POST /api/sessions/:id/chat
POST /api/sessions/:id/chat/stream
POST /api/sessions/new
POST /api/folder-picker
```

`POST /api/sessions/:id/chat` 请求体：

```json
{
  "workspace": "/path/to/project",
  "skills": ["plot-from-data", "github:github"],
  "message": "继续刚才的任务"
}
```

响应里会包含 Codex 的 JSONL 事件、提取出的最后一条 assistant 文本，以及刷新后的本地历史。

## 设计边界

浏览器前端目录选择器不能可靠暴露绝对本地路径，`showDirectoryPicker()` 只给目录 handle/name，`<input webkitdirectory>` 只给相对路径。后端启动 Codex 需要真实绝对路径，所以网页会优先匹配已有 Codex workspace，匹配不到时使用手填路径。真正执行 Codex 的仍然是本机 `codex` 命令。

`codex resume` 本身已经有交互式 picker 和 cwd 过滤，但它不提供适合网页/API 使用的结构化 session list/history 输出。所以 Codex Bridge 读取 JSONL 来生成列表和历史，并在发送消息时回到官方 `codex exec resume <session-id>` 通道。

`codex app-server`/`remote-control` 是官方实验能力，但这里没有直接绑定私有 app-server 协议。原因是当前 CLI 已经公开了 `codex exec resume --json`，对本地 API 和网页续聊来说更直接，也更容易跟 CLI 版本兼容。

## 测试

```bash
npm test
```
