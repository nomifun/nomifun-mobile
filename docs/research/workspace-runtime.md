# 工作目录（workspace）运行时链路 + 手机端项目会话所需接口

> 源仓库：`/home/rika/src/nomifun-tauri`（只读研究）。行号基于 `main` @ `3bd9a566`。

## 1. workspace 在 agent 执行时如何生效

链路（只列关键跳）：

1. **存储**：`conversations.extra` 是一整块 JSON 字符串，`extra.workspace` 是路径字符串。没有独立的 workspace 列。
2. **构造 runtime options**：`crates/backend/nomifun-conversation/src/service.rs:12171-12208`
   - 若 `extra` 里有 `temp_workspace_id`（后端托管的临时工作区）→ 忽略持久化的绝对路径，重算为
     `<workspace_root>/conversations/<temp_workspace_id>`，并把结果写回 `extra["workspace"]`。
   - 否则取 `extra.workspace`，过 `validate_runtime_workspace_path()`（`service.rs:12712`，只拒空串和
     路径段首尾空白 → `AppError::WorkspacePathEdgeWhitespaceRuntimeUnsupported`）。**不做白名单/沙箱校验**。
   - 两者都没有 → `Internal("conversation … has neither a custom workspace nor a canonical temp_workspace_id")`。
   - 若调用者不是宿主执行权威（`execution_authority(..).controls_host() == false`，即渠道/远程会话），
     整个 `extra` 被丢弃只保留 `temp_workspace_id` —— 远程侧**无法**塞自定义 workspace。
3. **工厂解析**：`crates/backend/nomifun-ai-agent/src/factory/context.rs:19-57`
   `FactoryContext { workspace, is_custom_workspace }`。`is_custom_workspace = true` 仅当无 `temp_workspace_id`
   且 `workspace` 非空（注释明确：不要再从路径字符串反推）。
4. **manager**：`crates/backend/nomifun-ai-agent/src/manager/nomi/agent.rs` ——
   `CliArgs.project_dir = Some(PathBuf::from(&workspace))`（:467）、`auto_memory_dir(workspace)`（:447）、
   `with_artifact_workspace(&workspace)`（:453）、`AgentBootstrap::new(config, &workspace, sink)`（:616）。
5. **agent 内核**：`crates/agent/nomi-agent/src/bootstrap.rs:436` `let cwd = &self.workspace;`，此后 cwd 同时是
   Bash/ExecCommand 的进程 cwd + `CapabilityPolicy.cwd_roots`（:511-557）、Grep/Glob/LSP 的搜索根（:511, :545-548）、
   skills 加载根（:586）、`AGENTS.md` 解析根（:594）、system prompt 注入的工作目录（:636）。
6. **写根钳制** `write_root`（`crates/backend/nomifun-ai-agent/src/types.rs:226-231`，实现
   `factory/nomi.rs:1060-1070`）：本地桌面私有会话 = `None`（**不钳制，等于 OS 用户全权**）；
   渠道/远程/对外 = `Some(workspace)`。
7. 子 agent：`crates/agent/nomi-agent/src/local_agent_invocation.rs:210-250` 的 `FanoutWorkspacePlan`
   给可变更的并行子 agent 开 git worktree；非 git 仓库降级为共享 workspace 并附警告（:703）。

## 2. `GET /api/conversations` / `:id` 是否回吐 workspace

**是，原样回吐，还额外注入一个派生字段。**

- DTO：`ConversationResponse.extra: serde_json::Value`（`crates/backend/nomifun-api-types/src/conversation.rs:349`）——
  没有任何字段裁剪，列表和单条走同一个 `row_to_response`。
- 列表类型：`ConversationListResponse = PaginatedResult<ConversationResponse>`（同文件 :353），
  路由 `crates/backend/nomifun-conversation/src/routes.rs:28` `post(create).get(list)`。
- 转换：`crates/backend/nomifun-conversation/src/convert.rs:40-73` `row_to_response_with_extra`
  把 `extra` JSON 原样反序列化后，**注入** `extra.is_temporary_workspace: bool`（不落库，每次读时算）：
  `!companion_session && workspace 非空 && workspace.starts_with(data_dir)`。

手机端可直接读的字段（全部在 `extra` 一层内，非嵌套）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `extra.workspace` | string | 绝对路径。托管临时工作区时是 `<data_dir>/conversations/<temp_workspace_id>` |
| `extra.is_temporary_workspace` | bool | 后端派生。`true` = 临时/托管工作区，UI 不该当"项目"展示 |
| `extra.custom_workspace` | bool | 前端写入的意图标记（创建时传，见 `useOpenSshSession.ts:44-50`） |
| `extra.temp_workspace_id` | string? | 存在即表示后端托管，`extra.workspace` 会被后端重算覆盖 |
| `extra.companion_session` | bool? | 伙伴会话；其 workspace 是固定的 per-companion 目录，非临时 |
| `extra.default_files` | string[] | 创建时预置文件列表 |

判定"这是个项目会话"的稳妥表达式：`type === 'nomi' && extra.workspace && !extra.is_temporary_workspace`。

## 3. 与「项目」相关的其它接口 / WS 事件

**工作区文件树（手机端最值得用的一个）**

- `GET /api/conversations/{conversation_id}/workspace?path=<rel>&search=<q>`
  - 路由 `crates/backend/nomifun-conversation/src/routes_aux.rs:38-41, 187-199`
  - service `crates/backend/nomifun-conversation/src/service_ops.rs:155-184`
  - 实现 `crates/backend/nomifun-file/src/workspace_listing.rs:39+`
  - Query（`crates/backend/nomifun-api-types/src/acp.rs:100-104`）：`path` **必填且非空**（根目录传 `"/"`），
    `search` 可选。
  - 返回 `ApiResponse<Vec<WorkspaceEntry>>`，`WorkspaceEntry { name: string, type: string }`
    （`acp.rs:106-112`，字段名就是 `type`）——**只有一层，不带 size/mtime，不递归**。逐层点进去。
  - 错误语义：无 workspace → 400 `"Conversation has no workspace assigned"`；
    workspace 根不存在 → 404 `"Workspace directory not found"`（注释里说明这是为了避免轮询打出 500 风暴）；
    `..` → 400 `"Path traversal outside workspace is not allowed"`。允许 workspace 内的符号链接目录。

**没有找到的东西（手机端不要指望）**

- 无「最近文件」接口；无项目级 artifact 接口（conversation artifact 只有
  `ConversationArtifactKind { CronTrigger, SkillSuggest }`，`conversation.rs:385+`，与文件无关；文件类 artifact
  走 `stream_relay.rs:1884` `with_artifact_workspace`，以消息内 artifact 推送，不可枚举）。
- 无 `workspace` 专属 WS 事件（`crates/backend/nomifun-realtime/src/*.rs` grep `workspace` 零命中）；
  工作区变化只能重新拉 `/workspace` 或从消息流的 tool/artifact 事件推断。

**选目录（手机端建项目会话的前置）**

- `GET /api/fs/browse?path=<abs>&show_files=true|false` —— 这就是 WebUI 的"宿主目录选择器"。
  - 路由 `crates/backend/nomifun-file/src/routes.rs:67, 108-121`；实现 `crates/backend/nomifun-file/src/browse.rs`
  - Query `BrowseDirectoryQuery { path: Option<String>, show_files: Option<String> }`
    （`crates/backend/nomifun-api-types/src/file.rs:130-140`，`show_files` 是**字符串** `"true"`/`"1"`；
    `path` 省略/空 = Unix 下当前工作目录，Windows 下盘符列表）
  - 响应 `BrowseDirectoryResponse { current_path, parent_path?, items: BrowseEntry[], can_go_up, truncated, is_root? }`
    （`file.rs:162-193`）；`BrowseEntry { name, path, is_directory, is_file, size?, modified? }`。
    单次上限 `MAX_BROWSE_ITEMS = 500`（`browse.rs:26`），超出置 `truncated`。
  - **Unix 上允许根是 `/`**（`browse.rs:37-58` `default_browse_roots`，注释写明"widest possible sandbox on Unix"）。
- `POST /api/fs/directory` 新建一层子目录（同一 root 策略），可让手机端"新建项目文件夹"。
- 整组 `/api/fs/*` 走 `protect_instance_owner`（`crates/backend/nomifun-app/src/router/routes.rs:776-781`），
  注释原文：*"Filesystem access executes as the backend OS user and includes the app data directory."*

**改绑工作目录**

- `PATCH /api/conversations/{id}`，body `{"extra": {"workspace": "/abs/path"}}`。
  - `extra` **默认就是 merge 语义**（`crates/backend/nomifun-api-types/src/conversation.rs:69` 文档注释，
    实现 `service.rs:5001-5023` 的 `merge_json` 浅合并）。
  - 副作用：workspace 变化会**回收缓存的 agent runtime**（`service.rs:5061-5075` + `:5147`），下一条消息生效。
    测试见 `crates/backend/nomifun-conversation/src/service_test.rs:2504` `update_workspace_change_recycles_agent`。

## 4. 桌面端会话详情如何展示工作目录

- **组件**：`ui/src/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader.tsx`
  —— 工作区侧栏头部。标题文本由 `WorkspaceRailBody.tsx:224` 传入。
- **显示 basename，不显示全路径**：`ui/src/renderer/utils/workspace/workspace.ts:25-35`
  `getWorkspaceDisplayName(path, isTemporaryWorkspace, t)`
  - `isTemporaryWorkspace === true` → 固定文案 `conversation.workspace.temporarySpace` = **"临时空间"**
  - 否则 → 路径最后一段（`splitPathSegments(...).pop()`），兼容 `\` 与 `/`
  - 注释明确：**权威信号只能来自 `extra.is_temporary_workspace`，禁止从路径形状猜**。
- **右侧按钮二选一**（`WorkspacePanelHeader.tsx:63-69`）：
  - 临时会话 → `WorkspaceBindButton`（图标 `FolderFocus`，走原生目录选择器，再 PATCH `extra.workspace`）
  - 已绑定 → `WorkspaceOpenButton`（下拉：VS Code / 终端 / 文件管理器，走 `ipcBridge.shell.openFolderWith`）
  - **两个按钮在 WebUI/浏览器模式都直接不渲染**（`WorkspaceBindButton.tsx:44` `isDesktopShell()` 守卫，
    `WorkspaceOpenButton.tsx:123` 注释："shell tools open on the server with no visible feedback"）。
    → 手机端天然对齐不了"打开目录"，但**"切换目录"完全可以做**（只是要自己实现目录选择器，见 `/api/fs/browse`）。
- **侧栏分组**：`ui/src/renderer/pages/conversation/SessionList/utils/workpathTree.ts:85-87`
  按 `extra.custom_workspace === true && extra.workspace` 归组，否则进 `__default__`
  （`workpathKey.ts`：去尾斜杠、`\`→`/`，空 → `__default__`）。
  分组名可选四种模式（`sessionList.json:34-38`：路径压缩 / 文件夹名 / 名称+上级 / 完整路径）。
- **注意 `custom_workspace` 是前端算的**：后端创建时就删掉了 `custom_workspace` /
  `is_temporary_workspace` / `temp_workspace_id`（`service.rs:4281-4283`），桌面在 mapper 里重算：
  `ui/src/common/adapter/apiModelMapper.ts:197-204` →
  `custom_workspace = workspace.length > 0 && !is_temporary_workspace`。手机端照抄这一行。
- **"项目列表 / 最近目录"是纯客户端 localStorage**：`SessionList/utils/projectWorkpaths.ts:31-43`、
  `ui/src/renderer/components/workspace/recentWorkspaces.ts:18-24`。**服务端没有项目表**，
  手机端要么本地存，要么从会话列表的 `extra.workspace` 去重现算。

## 5. 安全提示

**客观事实（决定提示口径）**

- 后端对 workspace 路径**几乎不校验**：只拒空串和"路径段首尾有空白"
  （`service.rs:12697-12710` `normalize_workspace_path` / `:12712` `validate_runtime_workspace_path`）。
  没有白名单、不要求目录已存在、不排除 `/`、`~/.ssh`、`/etc` 之类。
- 本地桌面私有会话 `write_root = None`，即**不钳制写根，等于后端 OS 用户全权**
  （`crates/backend/nomifun-ai-agent/src/types.rs:226-231`）。只有渠道/远程/对外会话才收窄到 workspace。
- 进程能力：Bash/ExecCommand 的 `cwd_roots` = workspace，但 Unix 默认
  `SandboxPolicy::UnrestrictedLocalOwner`（`bootstrap.rs:524-532`）——**不是真沙箱**，cd 出去照样能跑；
  `nomi-tools/src/path_guard.rs:9` 也自述只防误写：*"This stops accidental or buggy out-of-workspace writes"*。
- 真正的运行时闸门是逐次工具审批：`GET /api/conversations/{id}/confirmations` +
  `POST .../confirmations/{call_id}/confirm`（`routes.rs:66-73`）——比"选目录时弹个警告"更有效。

**桌面端现有文案（只有这些，没有风险警示）**

- `ui/src/renderer/services/i18n/locales/zh-CN/conversation.json:379-384`：label `"设置工作目录"`；
  hint `"绑定磁盘上的一个文件夹，Agent 将以此目录为主工作区。"`；
  success `"已绑定工作目录，Agent 将在该目录中工作。"`
- `conversation.json:297` 面板标题 `"项目"`；`:313` `"临时空间"`；
  `sessionList.json:53` 移除工作路径确认强调不删文件：`"从侧边栏移除「{{path}}」？不会删除本地文件或已有会话。"`
- 全仓 zh-CN **没有**任何针对 workspace 的"可读写/有风险"警示（grep `读写|谨慎|风险` 命中的全是
  browser-use / 伙伴令牌 / 更新免责）。

**手机端建议口径（比桌面更强，因为手机是远程操控一台真机）**

1. 创建前明示确认，**显示绝对全路径**（不是 basename），例如
   *"Agent 将以 `<全路径>` 为工作目录，可在其中读取、修改、删除文件并执行命令。"*
2. 危险目录**软拦截**（二次确认 + 红字）：`/`、`$HOME` 本身、`/etc`、`/usr`、`/System`、`C:\Windows`，
   以及含 `.ssh` / `.aws` / `.config/nomi` 的路径。后端不会拦，只能前端做。
3. 详情页 basename 常显 + 可展开全路径；临时会话显示"临时空间"并给"设置工作目录"入口。
4. 改绑目录二次确认，并说明"下一条消息才生效"（runtime 会被回收，见 §3）。
5. 接上工具审批 `/confirmations`，让"agent 要写这个文件"在手机上可见可拒。

## 手机端展示与管理清单

**必做**

1. 会话列表按项目分组：从 `GET /api/conversations` 的 `extra.workspace` +
   `extra.is_temporary_workspace` 现算分组键（照抄 `workpathKey`：`\`→`/`、去尾斜杠、空 → `__default__`），
   组名用 basename，`is_temporary_workspace` 的进"临时"组。
2. 会话详情显示工作目录：basename 常显，可展开看全路径；临时会话显示"临时空间"。
3. 创建项目会话：`POST /api/conversations`，`{type:'nomi', name, model?, extra:{ workspace: '<abs>' }}`。
   只需要 `extra.workspace`——`custom_workspace` / `is_temporary_workspace` / `temp_workspace_id`
   在创建时会被后端删掉（`service.rs:4281-4283`），传了也没用。
4. 目录选择器：`GET /api/fs/browse`（逐层，`show_files=false`），配 `POST /api/fs/directory` 新建文件夹。
   注意 `truncated`（500 上限）要提示用户。
5. 创建/改绑前的路径确认 + 危险目录软拦截（见 §5）。

**推荐**

6. 项目文件树：`GET /api/conversations/{id}/workspace?path=/`，逐层展开。响应只有 `{name, type}`，
   要内容/元数据再走 `POST /api/fs/read`（`ReadFileRequest { path, workspace? }`，`file.rs:27-31`）、
   `POST /api/fs/metadata`。
7. 改绑目录：`PATCH /api/conversations/{id}` `{"extra":{"workspace":"..."}}`，提示"下一条消息生效"。
8. 本地维护"最近项目"列表（服务端没有这个概念），可直接从会话列表里去重 `extra.workspace` 生成。
9. 接工具审批 `/confirmations`。

**明确不要做**

10. 不要做"打开目录"按钮 —— `ipcBridge.shell.openFolderWith` 是在**桌面机器上**开窗口，手机点了什么都看不到，
    桌面端自己也在非桌面 shell 下隐藏了这两个按钮。
11. 不要期待 workspace 相关的 WS 事件 / 项目级 artifact 接口 / 服务端最近文件接口 —— 都不存在（见 §3）。
12. 不要在 PATCH body 里带 `merge_extra`（见风险 1）。

## 风险 / 坑（读源码时发现，桌面端疑似 bug）

1. **`merge_extra` 会让 PATCH 直接 400。** `UpdateConversationRequest` 带
   `#[serde(deny_unknown_fields)]`（`crates/backend/nomifun-api-types/src/conversation.rs:71-73`），
   且 Rust 侧全仓没有 `merge_extra` 字段（grep `crates/` 零命中）。而桌面前端在四处显式发了它：
   `ui/src/common/adapter/ipcBridge.ts:646`、`WorkspaceBindButton.tsx:57`、
   `useAcpModelInfo.ts:457`、`platforms/nomi/useNomiMessage.ts:445`。
   → 手机端**只发 `{extra: {...}}`**（merge 本来就是默认语义）。桌面"设置工作目录"按钮可能是坏的，值得回报上游。
2. **给临时会话改绑目录可能不生效。** PATCH 路由会 strip 掉请求里的 `temp_workspace_id`
   （`crates/backend/nomifun-conversation/src/routes.rs:125`），但**不会删掉行里已有的那个**
   （`merge_json` 只做浅插入，`service.rs:13218-13224`）。而运行时构造
   （`service.rs:12171-12176`）和历史 artifact 解析（`service.rs:12797-12801`）都是
   **`temp_workspace_id` 优先**：只要这个 key 还在，`extra.workspace` 就被重算回
   `<data_dir>/conversations/<temp_workspace_id>`。
   已有测试 `service_test.rs:2504` 只覆盖了"一开始就带自定义 workspace"的会话，没覆盖 temp→custom。
   → 手机端**在创建时就把 `extra.workspace` 传进去**，不要走"先建临时会话再改绑"。
3. `/api/fs/*` 在 Unix 上的浏览根是 `/`（`crates/backend/nomifun-file/src/browse.rs:37-58`），
   且 `/api/fs/read` `/api/fs/write` 同组鉴权。手机端一旦持有 token 就等于持有该机文件系统的读写面 ——
   token 存储必须按最高敏感度处理。
4. workspace 路径**首尾空白的路径段**会被拒（`AppError::WorkspacePathEdgeWhitespace` /
   `…RuntimeUnsupported`，`service.rs:12697-12724`）。目录选择器把用户选中的路径原样回传即可，
   不要 trim 中间段，但要能把这两个错误码翻成人话。
5. `GET /api/conversations/{id}/workspace` 在 workspace 目录不存在时返回 **404**（不是 500，
   `workspace_listing.rs:66-78` 有注释说明这是为了避免轮询打出 500 风暴）。手机端拉文件树要把 404
   当成"目录还没建/已被删"而不是错误弹窗。
