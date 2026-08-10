# 后端文件系统浏览 HTTP 接口调研

> 调研对象：`/home/rika/src/nomifun-tauri`（只读）。目标：手机端能否浏览桌面文件系统，
> 从而为「项目会话」（绑定 workspace 工作目录的会话）选择目录。
>
> 状态：**已完成**

## 结论速览

1. **有现成接口。`GET /api/fs/browse` 就是为「无原生对话框的部署形态」造的
   HTTP 目录浏览器**，桌面 WebUI fallback 已经在用它。
2. **`/api/fs/*` 全部 29 条路由都不是 local-trust 独占**，门槛是
   Bearer + installation-owner（`protect_instance_owner`）。手机端以 owner
   身份登录即可全用。
3. 起点：`GET /api/fs/browse?path=~`（内置 `~` 展开）+ `GET /api/system/info`
   的 `work_dir` / `platform`。**没有**专门的 home/roots/drives 端点
   （Windows 盘符列表通过 `path=` 空串返回）。
4. **创建会话时后端不校验 workspace 是否存在** —— 只查非空 + 路径分量首尾空白，
   会一路 200，直到拉起 CLI 子进程时才 400。**手机端必须先用 browse 校验，
   并用返回的 `currentPath` 作为写入值。**
5. 两个已知缺口：**隐藏文件（`.` 开头）被硬过滤**、**单目录上限 500 项无分页**。
   这两种情况退化为手输即可（手输路径依然能通过 browse 校验，隐藏过滤只作用于子项）。
6. 无需在 nomifun-tauri 侧新增任何代码。可选补丁见第 6 节。

## 0. 关键源码定位速查

| 内容 | 路径 |
|------|------|
| fs 路由声明 | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-file/src/routes.rs:53-101` |
| browse 实现（沙箱 + 列目录） | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-file/src/browse.rs` |
| fs wire 类型 | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-api-types/src/file.rs` |
| 路由挂载 + 认证包装 | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-app/src/router/routes.rs:773-780` |
| owner 中间件 | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-auth/src/middleware.rs:145-162` |
| FileRouterState 构造（沙箱来源） | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-app/src/router/state.rs:104-112, 806-825` |
| 会话创建的 workspace 处理 | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-conversation/src/service.rs:4249-4289, 12697-12742` |
| 运行时 cwd 校验（真正的存在性检查） | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-ai-agent/src/capability/cli_process/mod.rs:33-61` |
| `is_temporary_workspace` 服务端派生 | `/home/rika/src/nomifun-tauri/crates/backend/nomifun-conversation/src/convert.rs:58-72` |
| `custom_workspace` 客户端派生 | `/home/rika/src/nomifun-tauri/ui/src/common/adapter/apiModelMapper.ts:197-203` |
| 桌面 WebUI 目录选择器（可照抄的 UI 契约） | `/home/rika/src/nomifun-tauri/ui/src/renderer/components/settings/DirectorySelectionModal.tsx` + `directorySelectionApi.ts` |
| 会话列表 workpath 分组 | `/home/rika/src/nomifun-tauri/ui/src/renderer/pages/conversation/SessionList/utils/sessionWorkpath.ts:27`、`workpathTree.ts:87` |

## 1. 全部 `/api/fs/*` 路由

路由声明唯一来源：`/home/rika/src/nomifun-tauri/crates/backend/nomifun-file/src/routes.rs:53-101`
（`pub fn file_routes(state: FileRouterState) -> Router`）。

挂载点：`/home/rika/src/nomifun-tauri/crates/backend/nomifun-app/src/router/routes.rs:773-780`

```rust
// Filesystem access executes as the backend OS user and includes the app
// data directory. It is therefore installation-owner control, not a
// row-scoped multi-user resource.
let file_authenticated = protect_instance_owner(
    file_routes(states.file),
    &auth_mw_state,
    &instance_owner_state,
);
```

### 认证结论（最关键）

- **`/api/fs/*` 全部端点都不是 local-trust 独占。** 全仓 `require_local_trust_middleware`
  的使用点只有三处，都与 fs 无关：
  - `crates/backend/nomifun-auth/src/routes.rs:107`
  - `crates/backend/nomifun-app/src/router/routes.rs:977`（`/api/terminals/register-knowledge*`）
  - `crates/backend/nomifun-app/src/router/companion_token_routes.rs:112`
- 实际门槛是 `protect_instance_owner` = 常规认证（Bearer）+
  `require_instance_owner_middleware`
  （`crates/backend/nomifun-auth/src/middleware.rs:145-162`：仅当
  `CurrentUser.id == 安装 owner 的 UserId` 才通过，否则
  403 `"Installation owner access required"`）。
- 因此**手机端只要以 owner 账号登录，就能直接调用所有 `/api/fs/*`**。
  POST 端点仍需 CSRF（`crates/backend/nomifun-auth/src/csrf.rs:51-53`：只有
  `LocalTrusted` 才被豁免 CSRF，远程调用方必须带 CSRF token —— 手机端 HTTP 层已具备）。

### 端点清单

| # | Method | Path | 用途 |
|---|--------|------|------|
| 1 | GET | `/api/fs/browse` | **浅层目录浏览器**（手机端要的那个） |
| 2 | POST | `/api/fs/directory` | 在 parent 下新建单层文件夹 |
| 3 | POST | `/api/fs/list` | 递归平铺列出 workspace 内文件 |
| 4 | POST | `/api/fs/metadata` | 单个文件/目录元数据 |
| 5 | POST | `/api/fs/read` | 读文件内容 |
| 6 | POST | `/api/fs/write` | 写文件 |
| 7 | POST | `/api/fs/copy` | 批量拷贝进 workspace |
| 8 | POST | `/api/fs/remove` | 删除文件/目录 |
| 9 | POST | `/api/fs/rename` | 重命名 |
| 10 | POST | `/api/fs/image-base64` | 图片转 base64 |
| 11 | POST | `/api/fs/fetch-remote-image` | 抓远端图片 |
| 12 | POST | `/api/fs/zip` | 打包 zip |
| 13 | POST | `/api/fs/zip/cancel` | 取消打包 |
| 14 | POST | `/api/fs/upload` | 多部分上传（独立 30MB body 限制，`UPLOAD_MAX_SIZE`） |
| 15 | POST | `/api/fs/watch/start` | 启动目录监听（事件走 WS） |
| 16 | POST | `/api/fs/watch/stop` | 停止监听 |
| 17 | POST | `/api/fs/watch/stop-all` | 停止全部监听 |
| 18 | POST | `/api/fs/office-watch/start` | Office 文件监听 |
| 19 | POST | `/api/fs/office-watch/stop` | 停止 Office 监听 |
| 20 | POST | `/api/fs/snapshot/init` | workspace 快照初始化 |
| 21 | POST | `/api/fs/snapshot/compare` | 快照对比 |
| 22 | POST | `/api/fs/snapshot/baseline` | 设基线 |
| 23 | POST | `/api/fs/snapshot/stage` | 暂存单文件 |
| 24 | POST | `/api/fs/snapshot/stage-all` | 暂存全部 |
| 25 | POST | `/api/fs/snapshot/unstage` | 取消暂存单文件 |
| 26 | POST | `/api/fs/snapshot/unstage-all` | 取消暂存全部 |
| 27 | POST | `/api/fs/snapshot/discard` | 丢弃改动 |
| 28 | POST | `/api/fs/snapshot/reset` | 重置 |
| 29 | POST | `/api/fs/snapshot/dispose` | 释放快照 |

所有请求/响应 wire 类型定义在
`/home/rika/src/nomifun-tauri/crates/backend/nomifun-api-types/src/file.rs`。
统一响应包封 `ApiResponse<T>`（`{ success, data, ... }`）。

> 注意：`/api/fs/list`、`/api/fs/read` 等这一组走的是 **`allowed_roots`** 沙箱
> （由 `default_allowed_roots(work_dir)` + `data_dir` 构成，见
> `crates/backend/nomifun-app/src/router/state.rs:806-825`），沙箱比 browse 的窄；
> 只有 `/api/fs/browse` 和 `/api/fs/directory` 走更宽的 **`browse_roots`**。

## 2. 列目录能力

**有，而且正是为「WebUI 主机文件选择器」而生的。**

核心实现：`/home/rika/src/nomifun-tauri/crates/backend/nomifun-file/src/browse.rs`（571 行）
handler：`crates/backend/nomifun-file/src/routes.rs:105-121`

### 请求

`GET /api/fs/browse?path=<urlencoded>&showFiles=true|false`

query 类型 `BrowseDirectoryQuery`（`nomifun-api-types/src/file.rs:119-140`，
`deny_unknown_fields` + camelCase，`show_files` 有 snake_case alias）：

- `path?: string` — 要列的目录。**空字符串 = 用默认值**（Unix：进程 cwd；
  Windows：返回盘符列表页）。Windows 上 `"__ROOT__"` 等价于空。
  支持 `~` / `~/Documents` 展开（`browse.rs:154-163` `expand_tilde`）。
- `showFiles?: string` — 只有字面量 `"true"` 或 `"1"` 才算 true
  （`routes.rs:111`：`matches!(query.show_files.as_deref(), Some("true") | Some("1"))`）。
  默认 false = **只返回目录**。

前端调用样例（可直接照抄）：
`/home/rika/src/nomifun-tauri/ui/src/renderer/components/settings/directorySelectionApi.ts:25-30`
```ts
`/api/fs/browse?path=${encodeURIComponent(path)}&showFiles=${showFiles ? 'true' : 'false'}`
```

### 响应

`BrowseDirectoryResponse`（`nomifun-api-types/src/file.rs:175-194`，camelCase）：

```ts
{
  currentPath: string;       // 已解析（canonicalize 后）的绝对路径；Windows 盘符页为 ""
  parentPath?: string;       // 上一级；Windows 盘符根返回 "__ROOT__" 哨兵
  items: BrowseEntry[];
  canGoUp: boolean;          // 上级仍在 allow-list 内才为 true
  truncated: boolean;        // 条目被截断
  isRoot?: boolean;          // true 表示这是 Windows 盘符列表页
}
```

`BrowseEntry`（`file.rs:156-173`）：
```ts
{
  name: string;
  path: string;              // 绝对路径，可直接回传给下一次 browse
  isDirectory: boolean;
  isFile: boolean;
  size?: number;             // 目录也会带（stat.len()）
  modified?: number;         // unix epoch 毫秒
}
```

### 能列任意路径吗？越界防护

- allow-list 由 `default_browse_roots()` 构建（`browse.rs:37-70`）：
  `cwd` + `dirs::home_dir()` + （Windows）所有存在的盘符 + （**Unix：`/`**）。
  → **在 Linux/macOS 桌面上等价于"整个文件系统可读列"**（注释明确说是最宽沙箱，
  为了能到 `/Volumes/*`）。Windows 上等价于所有盘符。
- 校验流程 `resolve_browse_path()`（`browse.rs:115-152`）：
  1. 拒绝含 `\0` 的路径 → 400；
  2. `~` 展开；
  3. `fs::canonicalize`（**先解符号链接再判沙箱**，指向外部的软链会被拒）
     - NotFound → 404 `path not found: {raw}`
     - 其它 IO 错 → 400 `cannot resolve path ...`
  4. 逐个 root 做 `canonical.starts_with(canonical_root)`；
     不匹配 → **403 `path '{}' is outside the allowed sandbox`**。
- 也就是说：有 canonicalize + 前缀白名单校验，但 Unix 下白名单含 `/`，
  所以实际不构成限制（这是设计意图，不是漏洞）。

### 条目语义

- 区分文件/目录：`isDirectory` / `isFile` 双字段。
- 带 `size` 与 `modified`（毫秒）。无可读 metadata 的项（如 Windows 盘符桩）省略这两个字段。
- **排序**：目录优先，然后按 name 字典序（`browse.rs:212-217`）。
- **上限 / 分页**：`MAX_BROWSE_ITEMS = 500`（`browse.rs:26`），超出直接
  `truncate(500)` 并把 `truncated: true`。**没有分页、没有 offset/cursor
  参数——大目录只能看前 500 项**（排序后的前 500，即目录在前）。
- **隐藏文件**：`name.starts_with('.')` 的条目**一律过滤掉**
  （`browse.rs:195-197`，注释说是沿用 Express 旧行为）。没有开关。
  → 手机端无法通过此接口看到 `~/.config`、`.git` 等；如果 workspace 是隐藏目录
  下的路径，用户只能手输。
- 不可读条目（权限/悬空软链）静默跳过（`browse.rs:199-203`）。
- 阻塞 IO 跑在 `spawn_blocking`（`routes.rs:115`），不会堵住 runtime。

### 配套：新建目录

`POST /api/fs/directory` body `{ parentPath, name }`
（`CreateDirectoryRequest`，`file.rs:142-155`；handler `routes.rs:123-138`）
→ 返回单个 `BrowseEntry`。只接受**一个**文件夹名分量，不能借此创建嵌套路径；
parent 走同一套 `browse_roots` 沙箱。手机端"新建项目目录"可用这个。

## 3. 家目录 / 常用根 / 磁盘列表

**没有专门的 "home dir / user dirs / drives" HTTP 端点。** 但有三条可用的起点：

1. **`GET /api/fs/browse?path=~`** —— `resolve_browse_path` 内置 `~` 展开
   （`browse.rs:154-163`），且 `home_dir()` 本身就是 browse allow-list 成员。
   **这是手机端最省事的起点：直接请求 `path=~` 就得到家目录列表**，响应里的
   `currentPath` 就是家目录的绝对路径（可缓存）。
2. **`GET /api/fs/browse?path=`（空）** —— Unix 上返回 `std::env::current_dir()`
   的列表（`browse.rs:290-300`），也就是桌面进程的 cwd。对手机端不太有用
   （可能是 app bundle 目录）。Windows 上返回**盘符列表页**（`isRoot: true`，
   `items` 是 `C:` `D:` …，`browse.rs:85-108` `drive_list_response`），
   这就是磁盘列表能力 —— 仅 Windows，没有单独端点。
3. **`GET /api/system/info`** —— 返回 `{ cache_dir, work_dir, log_dir,
   storage_generation, platform, arch }`
   （`crates/backend/nomifun-api-types/src/lifecycle.rs:5-17`，handler
   `nomifun-system/src/routes.rs:147,555-558`；前端映射
   `ui/src/common/adapter/ipcBridge.ts:905-925`）。
   **`work_dir` = 会话工作区根目录**，是"新建项目会话"最自然的默认起点；
   `platform` 又能告诉手机端要不要走 Windows 盘符分支。
   该路由同样在 `protect_instance_owner` 组内（`router/routes.rs:719-721`）。

grep 结论（无相关端点）：`home_dir` / `user_dirs` / `default_workspace` 在
crates/backend 里只出现在内部服务构造处，例如
`crates/backend/nomifun-app/src/router/state.rs:104-112` 的
`default_allowed_roots()`，和 `browse.rs:37-70` 的 `default_browse_roots()`，
**都没有暴露成 HTTP**。

桌面端拿家目录走的是 Tauri：
`ui/src/common/adapter/ipcBridge.ts:926`
```ts
getPath: shellProvider<string, { name: 'desktop' | 'home' | 'downloads' }>(({ name }) => tauriGetPath(name), ''),
```
`shellProvider`（`ui/src/common/adapter/tauriShell.ts:47-60`）在非 Tauri 运行时
直接返回 fallback `''` —— 也就是 **WebUI / 远程形态下 `getPath` 恒为空字符串**。
手机端不要指望这条，用上面的 `path=~` 或 `/api/system/info.work_dir`。

## 4. 路径校验端点 / 创建会话时的 workspace 校验

### 有没有独立的「校验路径」端点？

**没有专门的 `POST /api/fs/validate` 之类。** 但可以拿现成端点当校验器：

- **`GET /api/fs/browse?path=<候选>`** 就是最好的存在性 + 目录性校验器：
  - 不存在 → **404** `path not found: {raw}`（`browse.rs:130-134`）
  - 不是目录 → **400** `path is not a directory`（`browse.rs:170-173`）
  - 越界 → **403** `path '{}' is outside the allowed sandbox`
  - 成功 → 200，且 `currentPath` 是 canonicalize 后的规范绝对路径
    （手机端应当用它替换用户输入，避免存进 `extra.workspace` 的是相对/带 `..` 的路径）
- `POST /api/fs/metadata` 返回 `FileMetadataResponse { name, path, size, type,
  last_modified, is_directory? }`（`nomifun-api-types/src/file.rs:203-212`），
  但它走的是更窄的 `allowed_roots` 沙箱，对任意项目目录不一定通过。**校验请用
  `/api/fs/browse`。**
- 可写性（writable）**没有任何端点能测**。只能间接：`POST /api/fs/directory`
  建一个探针目录（但会留下垃圾目录，不推荐）。

### workspace 指向不存在的路径会怎样？

**创建时静默接受（200），运行时才炸。** 证据链：

1. `POST /api/conversations` → `service.rs:4249-4260`：
   ```rust
   let user_supplied_workspace = match extra
       .get("workspace").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
   { Some(workspace) => Some(normalize_workspace_path(workspace)?), None => None };
   ```
2. `normalize_workspace_path`（`service.rs:12697-12710`）**只做两件事**：
   - 空/纯空白 → 400 `"Workspace directory is empty"`
   - 路径某个分量首尾有空白 → `AppError::WorkspacePathEdgeWhitespace`
   - **不 canonicalize、不查 exists、不查 is_dir、不做任何沙箱前缀校验。**
     直接 `Ok(workspace.to_owned())` 原样存进 `extra.workspace`。
3. 运行时构建 agent runtime 时走 `validate_runtime_workspace_path`
   （`service.rs:12712-12725`，被 `service.rs:12180` 和 `12809` 调用）——
   **同样只查空 + 边缘空白，仍然不查存在性。**
4. 真正的存在性检查发生在**拉起 CLI 子进程**那一刻：
   `crates/backend/nomifun-ai-agent/src/capability/cli_process/mod.rs:33-61`
   `prepare_command_cwd()`：
   - NotFound → 400 `Workspace directory does not exist: {path}`
   - 不是目录 → 400 `Workspace path is not a directory: {path}`
   - 无权限 → 400 `Workspace directory is not accessible: {path}: {e}`

**手机端结论**：会话能建出来，但第一条消息发出去时才失败。所以**必须在客户端
用 `/api/fs/browse` 先验证一次路径**（并用返回的 `currentPath` 作为最终写入值），
否则用户体验是"建完了才报错"。

另外三个坑：
- 路径分量首尾**不能有空白**（如 `/Users/a/ my project`、`/x/proj /sub`），
  创建时就 400（`workspace_path_has_edge_whitespace_segment`）。
  macOS 的 `~/Library/Application Support/...` 这种中间带空格是 OK 的，
  只有**分量的首尾**空白不行。
- `extra.workspace` 为空字符串（`''`）= **不是自定义 workspace**，后端自动在
  `{work_dir}/conversations/{uuidv7}/` 下开一个临时 workspace
  （`service.rs:4266-4272`、`12729-12742`）。这正是
  `ui/src/renderer/pages/conversation/hooks/useOpenSshSession.ts:44-50` 里
  `extra: { workspace: '', custom_workspace: false, default_files: [] }` 的含义。
  → **手机端如果只想要"普通会话"，`workspace: ''` 就够了；只有"项目会话"才需要真路径。**
- `custom_workspace` / `is_temporary_workspace` / `temp_workspace_id` 这三个
  request 字段在创建时被**强制剥离**（`service.rs:4277-4289`），
  `custom_workspace` 传不传都不影响后端行为 —— 后端只看 `extra.workspace`
  非空与否。传了也无害（在 extra 白名单里，`service.rs:114-132`）。
- `~` **不会**在会话创建路径上展开（只有 `/api/fs/browse` 展开 `~`）。
  手机端必须写入绝对路径 —— 再一个理由要求先过一遍 browse 取 `currentPath`。

## 5. 桌面端是怎么选目录的

**两条路，Tauri 原生对话框是主路径，但 HTTP 目录浏览器 fallback 已经存在。**

- 统一入口 `dialog.showOpen`
  （`ui/src/common/adapter/ipcBridge.ts:1089-1093`）:
  ```ts
  export const dialog = {
    showOpen: shellProvider<string[] | undefined, ShellOpenDialogOptions | void>(
      (opts) => tauriOpenDialog(opts || undefined),
      (opts) => bridge.invoke<string[] | undefined>('show-open', opts || undefined)
    ),
  };
  ```
  上方注释就写着 "Dialog — stays IPC (native file picker)"。
- `shellProvider`（`ui/src/common/adapter/tauriShell.ts:47-60`）：
  `isTauriRuntime()` 为真时走 Tauri 原生 dialog（**完全绕过 HTTP**）；
  否则走 web fallback。
- **web fallback 不是"报错/空"，而是一个自研的 HTTP 目录浏览器**：
  `bridge.invoke('show-open')` 触发 `SHOW_OPEN_REQUEST_EVENT`
  （`ui/src/common/adapter/constant.ts:13`）→
  `ui/src/renderer/hooks/file/useDirectorySelection.tsx:51-70` 弹出
  `DirectorySelectionModal`
  （`ui/src/renderer/components/settings/DirectorySelectionModal.tsx`，521 行，
  树形浏览 + 面包屑 + 新建文件夹 + `isFileMode` 切文件/目录模式）→ 它调用
  `ui/src/renderer/components/settings/directorySelectionApi.ts` 的
  `browseDirectory()` / `createDirectory()` → 打 `/api/fs/browse` 与
  `/api/fs/directory`。
- `DirectorySelectionModal` 的起点是 `loadInitialTree('')`（空 path，
  `DirectorySelectionModal.tsx:112-152`），即"后端默认目录"（Unix: cwd /
  Windows: 盘符列表）。

**所以这块能力在 WebUI / 远程形态下并不缺失** —— `/api/fs/browse` 就是为
"没有原生 dialog 的部署形态"专门补的那条路。`browse.rs:1-11` 的模块注释确认：

> This handler lists a single directory level ... It is only reachable in WebUI
> deployments; the Electron desktop path uses the native OS dialog and never
> hits this route.

（注释里的 "Electron" 是历史遗留措辞，现在是 Tauri。）

## 6. 新增端点的成本评估（结论：**不需要新增，可选的是两个小补丁**）

因为 `GET /api/fs/browse` 已经存在且远程可用，**核心能力无需在 nomifun-tauri
侧动任何代码**。下面只评估两个"可选补强"，供后续需要时参考（本次不实施）。

### 补丁 A：`showHidden` 开关（成本：小，~15 行 + 测试）

动机：隐藏文件被硬过滤（`browse.rs:195-197`），手机端看不到 `.config`、
`.git`、`~/.local/...` 等目录下的项目。

改动面：
1. `crates/backend/nomifun-api-types/src/file.rs:119-140` —
   `BrowseDirectoryQuery` 加 `#[serde(default, alias = "show_hidden")] pub show_hidden: Option<String>`
   （注意结构体是 `deny_unknown_fields`，新字段必须显式加，否则老客户端传了会 400）。
2. `crates/backend/nomifun-file/src/browse.rs:167-176` `list_directory` 签名加
   `show_hidden: bool`，把 `if name.starts_with('.') { continue; }` 改成
   `if !show_hidden && name.starts_with('.') { continue; }`。
3. `browse.rs:281-303` `browse()` 透传；
   `crates/backend/nomifun-file/src/routes.rs:105-121` handler 解析（复用
   `matches!(..., Some("true") | Some("1"))` 的写法）。
4. 测试落 `crates/backend/nomifun-file/tests/browse_routes.rs` /
   `directory_browsing.rs`（这两个集成测试文件已存在，是天然落点）。

沙箱不变（仍是 `browse_roots` + canonicalize + `starts_with`），**没有新增安全面**
—— 隐藏与否只是显示过滤，路径校验完全不变。

### 补丁 B：`GET /api/fs/roots`（成本：小，~40 行 + 路由 + 测试）

动机：手机端需要"常用起点"列表（家目录 / work_dir / 下载 / 桌面 / Windows 盘符），
现在要靠 `path=~` + `/api/system/info` 拼。

改动面：
1. `crates/backend/nomifun-file/src/browse.rs` —— 已有 `default_browse_roots()`
   和（Windows）`enumerate_windows_drives()` / `drive_list_response()`
   **可直接复用**，只需加一个返回 `Vec<BrowseEntry>` 的 `list_roots()`。
2. `crates/backend/nomifun-api-types/src/file.rs` —— 新增
   `RootsResponse { items: Vec<BrowseEntry> }`（或直接复用
   `BrowseDirectoryResponse` + `isRoot: true`，**零新类型**，更省）。
3. `crates/backend/nomifun-file/src/routes.rs:67` 附近加
   `.route("/api/fs/roots", get(list_roots))`。
4. 认证：**什么都不用做** —— 整个 `file_routes` 已被
   `protect_instance_owner` 包住（`nomifun-app/src/router/routes.rs:773-780`），
   新路由自动继承 Bearer + owner 校验；GET 不需要 CSRF。
5. `work_dir` 若要一起返回，需要把 `services.work_dir` 塞进 `FileRouterState`
   （`crates/backend/nomifun-app/src/router/state.rs:806-825` 的 `build_file_state`
   里已经能拿到 `services.work_dir`，加一个字段即可）。

**越界防护怎么做**：不要自己写路径拼接——一律走 `resolve_browse_path()`
（`browse.rs:115-152`，已含 null-byte 拒绝、`~` 展开、canonicalize 后
`starts_with` 白名单）。任何新端点只要"先 `resolve_browse_path`，再操作"
就与现有端点等强。

### 明确**不建议**新增的东西

- 分页 / cursor：`MAX_BROWSE_ITEMS = 500` + `truncated` 已能表达"太多了"，
  手机屏上 500 项本来就该靠搜索而不是翻页。改成分页要动 wire 类型 + 桌面端
  Modal，收益不匹配。
- "可写性探测"端点：语义在 POSIX 上本就不可靠（ACL / 只读挂载 / 磁盘满），
  真正的失败点已在 `prepare_command_cwd` 有清晰报错。

## 7. 手机端可行路径

### 情形 A：有现成接口 ← **这就是实际情况**

手机端**不需要退化为手输**，可以做一个真正的目录选择器，纯 HTTP，全部端点
都在 `protect_instance_owner`（Bearer + owner）之下，**无一条是 local-trust 独占**：

推荐流程：

1. 启动时 `GET /api/system/info` → 拿 `work_dir`（默认起点候选）和 `platform`
   （决定要不要做 Windows 盘符页）。
2. 目录选择器首屏：`GET /api/fs/browse?path=~&showFiles=false`
   → 家目录的子目录列表；`currentPath` 是家目录绝对路径。
   - Windows：先 `GET /api/fs/browse?path=`（空）拿 `isRoot: true` 的盘符页，
     再逐层下钻。
   - 额外的"快捷入口"直接用 `work_dir`（来自步骤 1）当一个固定按钮。
3. 下钻：点某项 → `GET /api/fs/browse?path=<item.path>`（item.path 已是绝对路径）。
   返回上一级用 `parentPath`，`canGoUp === false` 时禁用返回按钮；
   `parentPath === "__ROOT__"`（仅 Windows）表示回盘符页。
4. `truncated === true` 时在列表尾部提示"仅显示前 500 项"。
5. 需要新建项目目录：`POST /api/fs/directory { parentPath, name }`
   （单层名，带 CSRF）→ 返回新目录的 `BrowseEntry`，直接选中它。
6. 用户确认后，用**上一步 browse 返回的 `currentPath`**（而不是用户可能手输的
   原串）作为 workspace，`POST /api/conversations`：
   ```json
   { "type": "nomi", "name": "...", "extra": { "workspace": "/abs/path", "default_files": [] } }
   ```
   （`custom_workspace` 可传可不传，后端会剥掉；后端只看 `workspace` 是否非空。）
7. 若还想支持手输路径作为高级入口：把用户输入先丢给
   `GET /api/fs/browse?path=<输入>` 做校验，映射错误码：
   404 = 路径不存在，400 = 不是目录，403 = 越界。**不要直接把手输串写进
   `extra.workspace`** —— 创建接口不做存在性校验，会拖到发第一条消息时才炸
   （见第 4 节）。

会话列表侧的项目分组（对齐桌面行为）：
- 服务端响应的 `extra` **不含** `custom_workspace`，只含服务端计算的
  `is_temporary_workspace`（`crates/backend/nomifun-conversation/src/convert.rs:58-72`：
  非 companion 且 `workspace` 非空且 `workspace` 在 data_dir 之下 → true）。
- 桌面端在客户端派生：
  `ui/src/common/adapter/apiModelMapper.ts:197-203`
  ```ts
  custom_workspace: workspace.length > 0 && !isTemporary
  ```
- 分组键：`ui/src/renderer/pages/conversation/SessionList/utils/sessionWorkpath.ts:27`
  与 `workpathTree.ts:87` —— `custom_workspace === true` 才按 `workpathKey(workspace)`
  分组，否则归入 `DEFAULT_WORKPATH_KEY`。
- **手机端要复刻同一条派生规则**，不要指望服务端直接给 `custom_workspace`。

### 情形 B：需新增 / 退化为手输 —— 仅这几个边角

只有以下场景才需要补丁或退化：

| 场景 | 现状 | 处置 |
|------|------|------|
| 目标目录是隐藏目录或在隐藏目录下（`~/.config/x`、`~/.local/share/y`） | browse 硬过滤 `.` 开头项，浏览不到 | **退化为手输**（手输仍可通过 `browse?path=` 校验，因为 `resolve_browse_path` 不过滤隐藏项，过滤只发生在列子项时）；或上第 6 节补丁 A |
| 单目录超过 500 项且目标在 500 之后 | `truncated: true`，无分页 | 退化为手输该子路径 |
| 需要"常用根目录"一键入口 | 无 `/api/fs/roots` | 用 `path=~` + `/api/system/info.work_dir` 拼，够用 |
| 需要判断目录可写 | 无端点 | 不做；让 `prepare_command_cwd` 的运行时报错兜底 |

> 关键提醒：手输路径校验时 `browse?path=<隐藏目录>` **是能成功的** ——
> 隐藏过滤只作用于 `list_directory` 列出的子项，不作用于被列的那个目录本身
> （`browse.rs:167-176` 先 `metadata`/`is_dir` 检查，`195-197` 才过滤子项）。
> 所以"手输 `~/.config/myproj` → browse 校验通过 → 建会话"这条路是通的。
