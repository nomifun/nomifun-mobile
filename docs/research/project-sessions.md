# 桌面端「项目会话」（带工作目录的会话）契约

> 研究中（增量写入）。源码基准：`/home/rika/src/nomifun-tauri` @ `main` `3bd9a566`

## 1. extra 中与工作目录相关的字段

### 1.1 类型定义：extra 是自由 JSON，没有 serde 结构

`POST /api/conversations` 的 body 类型在
`crates/backend/nomifun-api-types/src/conversation.rs:31-65`：

```rust
/// Body for `POST /api/conversations`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateConversationRequest {
    pub r#type: AgentType,
    pub name: Option<String>,
    // model / source / channel_chat_id / preset_id / preset_overrides /
    // delegation_policy / execution_model_pool / decision_policy /
    // execution_template_id ...
    pub extra: serde_json::Value,
}
```

要点：

- `deny_unknown_fields` **只作用于顶层**（`type/name/model/extra/...`）。顶层写错
  一个键就 400。
- `extra` 是 `serde_json::Value`，**没有 `ConversationExtra` 结构体，没有字段白名
  单，没有 deny_unknown_fields**。任意键都能塞进去并被原样持久化到
  `conversation.extra`（TEXT 列）。
- `extra` **没有 `#[serde(default)]`**，是必填字段 —— 不传 `extra` 会 400。空对象
  `{}` 合法（`conversation.rs:737` 的 `deserialize_create_request_missing_extra` 测
  试固化了这一点）。

因此「`extra` 里全部与工作目录相关的字段」不是从一个结构体读出来的，而是散在
service 层的字符串键。下面按「客户端可写」/「后端拥有」分类。

### 1.2 客户端可写的工作目录字段

| 键 | 类型 | 语义 | 默认 |
|---|---|---|---|
| `workspace` | string | 唯一真正生效的字段。非空 ⇒ 该会话是「项目会话」，工作目录就是这个路径。空串/缺失 ⇒ 后端自动开一个临时工作区。 | 缺失 |
| `custom_workspace` | bool | **纯前端 hint，创建时被服务端无条件删除**，不落库。服务端自己根据 `workspace` 是否非空推导 `is_custom_workspace`。 | — |
| `default_files` | string[] | 与工作目录无关（见 §6）。创建时原样存进 extra。 | `[]` |

`workspace` 的处理，`crates/backend/nomifun-conversation/src/service.rs:4244-4289`：

```rust
let user_supplied_workspace = match extra
    .get("workspace")
    .and_then(|v| v.as_str())
    .filter(|s| !s.is_empty())
{
    Some(workspace) => Some(normalize_workspace_path(workspace)?),
    None => None,
};
let is_custom_workspace = user_supplied_workspace.is_some();
if let Some(workspace) = user_supplied_workspace.as_ref() {
    extra["workspace"] = serde_json::Value::String(workspace.clone());
}
// ...
if let Some(obj) = extra.as_object_mut() {
    obj.remove("custom_workspace");
    obj.remove("is_temporary_workspace");
    obj.remove(TEMP_WORKSPACE_ID_EXTRA_KEY);   // "temp_workspace_id"
    if let Some(temp_workspace_id) = auto_workspace.as_ref() {
        obj.insert(TEMP_WORKSPACE_ID_EXTRA_KEY.to_owned(), json!(temp_workspace_id));
    }
}
```

**结论：手机端只需要发 `extra.workspace`。`custom_workspace` 发了也会被删，发或不
发结果完全一样**（桌面端发它只是历史习惯 / 本地 store 用）。

### 1.3 后端拥有的字段（客户端不要发）

- `temp_workspace_id`（常量 `service.rs:80`）：自动工作区的持久 token。创建时被
  strip，只有后端写。
- `is_temporary_workspace`：**响应期派生，不落库**。
  `crates/backend/nomifun-conversation/src/convert.rs:58-72`：

  ```rust
  let is_temporary_workspace = {
      let ws = extra.get("workspace").and_then(|v| v.as_str()).unwrap_or("");
      let is_companion = extra.get("companion_session").and_then(|v| v.as_bool()).unwrap_or(false);
      !is_companion && !ws.is_empty() && Path::new(ws).starts_with(data_dir)
  };
  ```

  即「workspace 位于后端 data_dir 之下」⇒ 临时工作区。伙伴会话（`companion_session:
  true`）虽然也在 data_dir 下，但强制标为非临时。
- `workspace_id` / `workspaceId`：只出现在 clone 的剥离清单里
  （`service.rs:119-148` 的 `strip_clone_instance_state`），当前代码没有写入方，视
  为遗留键。
- **没有 `workspace_name`，没有 `project_id`。** `workpath` 这个名字只存在于 MCP 工
  具层参数（见 §2.4），HTTP `extra` 里不用它。

### 1.4 服务端校验：几乎没有

`normalize_workspace_path`，`service.rs:12697-12710`：

```rust
fn normalize_workspace_path(workspace: &str) -> Result<String, AppError> {
    if workspace.trim().is_empty() {
        return Err(AppError::BadRequest("Workspace directory is empty".into()));
    }
    let workspace_path = PathBuf::from(workspace);
    if workspace_path_has_edge_whitespace_segment(&workspace_path) {
        return Err(AppError::WorkspacePathEdgeWhitespace(
            workspace_path.display().to_string(),
        ));
    }
    Ok(workspace.to_owned())
}
```

**它不做规范化。** 名字骗人：函数只校验，原样返回。所以：

- **不要求路径存在。**
- **不要求绝对路径。** 相对路径会被原样存下来（后果由运行期承担）。
- **不做 canonicalize / 去 `..` / 展开 `~`。** `~/foo` 会被当成字面目录名 `~`。
- **不会为用户指定的目录自动 mkdir。** `service.rs:4558-4602` 里
  `std::fs::create_dir_all` 只在 `managed_workspace`（自动工作区）分支执行，注释明
  写 "User-supplied workspaces are left untouched."
- 唯一的硬校验是**路径段首尾空白**：任一 normal 组件 `trim()` 后长度变化或为空即
  拒绝（`crates/backend/nomifun-common/src/error.rs:154-164`）。中间空格允许
  （`My Project` OK）。

自动工作区路径：`{work_dir}/conversations/{uuidv7}/`
（`service.rs:12739-12743` 的 `auto_temp_workspace_path`）。

## 2. 桌面 UI 新建项目/选目录流程

### 2.1 入口：侧栏底部「新建项目」

`ui/src/renderer/pages/conversation/components/ConversationShell/index.tsx:119-134`：

```ts
const handleCreateProject = useCallback(async () => {
  setBatchMode(false);
  try {
    const paths = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
    const projectPath = paths?.[0]?.trim();
    if (!projectPath) return;
    addProjectWorkpath(projectPath);        // localStorage：让空项目节点出现在侧栏
    addRecentWorkspace(projectPath);        // localStorage：最近使用列表
    void navigate('/guid', { state: { workspace: projectPath } });
    ...
```

注意：**「新建项目」这一步不创建任何会话**。它只是
1) 把路径写进两个 localStorage 列表，2) 跳到 `/guid`（新建会话向导）并把路径塞进
router state。会话是在 `/guid` 里发第一条消息时才真正 POST 出去的。

侧栏项目抽屉上的「+」也只是带 state 跳 `/guid`
（`SessionList/index.tsx:312-322`，`state: { workspace: node.key }`）。

### 2.2 选目录用的是 Tauri 原生对话框 —— 手机端不可用

`ui/src/common/adapter/ipcBridge.ts:1088-1093`：

```ts
// Dialog — stays IPC (native file picker)
export const dialog = {
  showOpen: shellProvider<string[] | undefined, ShellOpenDialogOptions | void>(
    (opts) => tauriOpenDialog(opts || undefined),
    (opts) => bridge.invoke<string[] | undefined>('show-open', opts || undefined)
  ),
};
```

两条腿都不是 HTTP：Tauri plugin-dialog 或 Electron 期的 IPC bridge。手机端必须换成
WebUI 那套 HTTP 目录浏览器（见 §2.5）。

### 2.3 真正的 POST body 构造点

统一在 `ui/src/common/utils/buildAgentConversationParams.ts`：

```ts
const type = getConversationTypeForBackend(backend);
const extra: ICreateConversationParams['extra'] = {
  workspace,
  custom_workspace,        // 默认 true（函数签名里 `custom_workspace = true`）
  ...extraOverrides,
};
// acp 分支再补 backend / agent_name / agent_id / cli_path
return { type, model, name, preset_id: is_preset ? preset_id : undefined, extra };
```

`/guid` 的实际调用点 `ui/src/renderer/pages/guid/hooks/useGuidSend.ts`（四个分支：
nomi / acp / preset / remote），workspace 相关部分形如
`useGuidSend.ts:203-212`、`:270-276`、`:338-341`、`:417-432`：

```ts
workspace: finalWorkspace,
custom_workspace: isCustomWorkspace,
extra: {
  default_files: files,
  ...
}
```

已确认的另一个最小样例（SSH 会话），`useOpenSshSession.ts:44-50`：

```ts
extra: { workspace: '', custom_workspace: false, default_files: [] }
```

即「不指定工作目录」= `workspace: ''`（或干脆不给这个键），服务端会自动开临时工作区。

所以手机端的 body 就是：

```jsonc
// 项目会话
POST /api/conversations
{ "type": "nomi", "name": "我的项目", "model": {...},
  "extra": { "workspace": "/home/rika/src/foo" } }

// 普通会话（自动临时工作区）
{ "type": "nomi", "name": "随手聊", "model": {...}, "extra": {} }
```

`custom_workspace` / `default_files` 都可以省（前者被服务端删，后者见 §6）。

### 2.4 另一条已有的服务端通路：MCP 工具 `workpath`

`crates/backend/nomifun-gateway/src/caps_conversation.rs:115-120` +
`:471-482`：MCP 侧的 `nomi_create_conversation` 用参数名 `workpath`，服务端把它转成
`extra.workspace`：

```rust
/// Absolute project path the user gave you. Sets the conversation's
/// workspace ("project session", grouped under that workpath in the
/// sidebar). Omit for an auto-provisioned workspace. Not valid for
/// agent_type "remote".
#[serde(default)]
workpath: Option<String>,
// ...
if let Some(workpath) = p.workpath.as_deref() {
    if agent_type == AgentType::Remote {
        return json!({ "error": "workpath is not valid for remote conversations" });
    }
    match normalized_workpath(workpath) {
        Ok(path) => extra["workspace"] = json!(path),
        Err(e) => return json!({ "error": e }),
    }
}
```

这是**官方对「项目会话 = extra.workspace 非空」的确认**，而且明确了 `remote` 类型不
支持 workspace。手机端仍应走 REST（`extra.workspace`），不必用 MCP。

### 2.5 手机端替代方案：HTTP 目录浏览器（已存在）

`crates/backend/nomifun-file/src/routes.rs:67-68`：

```rust
.route("/api/fs/browse", get(browse_directory))
.route("/api/fs/directory", post(create_directory))
```

- `GET /api/fs/browse?path=<dir>&showFiles=false` → `BrowseDirectoryResponse`
  （`crates/backend/nomifun-api-types/src/file.rs:119-193`，**camelCase 线上格式**）：
  `{ currentPath, parentPath?, items: [{name, path, isDirectory, isFile, size?, modified?}],
  canGoUp, truncated, isRoot? }`。
  `path` 空串 = 默认（Unix: cwd；Windows: 盘符列表）；`"__ROOT__"` 是 Windows 盘符列
  表哨兵（`browse.rs:22`）。单次最多 500 条，超出 `truncated: true`
  （`browse.rs:26`）。
- `POST /api/fs/directory` body `{ parentPath, name }`（`file.rs:142-154`），只允许建
  **一级**子目录 —— 正好覆盖「新建项目文件夹」。
- 沙箱：`default_browse_roots()`（`browse.rs:37-72`）在 Unix 上直接把 `/` 放进
  allow-list（注释：WebUI 场景确实需要走出 $HOME），Windows 是所有盘符 + cwd + home。
  也就是**手机端基本可以浏览整个文件系统**。
- 桌面注释写着 "WebUI-only … the Electron desktop path uses the native OS dialog and
  never hits this route"，但路由在同一个 axum router 里，手机端可直接用。

桌面 WebUI 模式下的对应 UI 组件是
`ui/src/renderer/components/settings/DirectorySelectionModal.tsx`（521 行），可作为交
互参考。

## 3. 创建后能否改工作目录

**能。** `PATCH /api/conversations/:id` 接受 `extra.workspace`。

类型：`crates/backend/nomifun-api-types/src/conversation.rs:67-91`

```rust
/// Body for `PATCH /api/conversations/:id`.
///
/// All fields optional — only supplied fields are applied.
/// `extra` uses merge semantics (patch, not replace).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateConversationRequest {
    pub name: Option<String>,
    pub pinned: Option<bool>,
    pub model: Option<ProviderWithModel>,
    // delegation_policy / execution_model_pool / decision_policy /
    // execution_template_id ...
    pub extra: Option<serde_json::Value>,
}
```

merge 语义在 `service.rs:5001-5023`：

```rust
let merged_extra = if let Some(new_extra) = &req.extra {
    let mut existing_extra: serde_json::Value = serde_json::from_str(&existing.extra)?;
    // ... must be object
    merge_json(&mut existing_extra, new_extra);
    if new_extra.get("workspace").is_some() {
        normalize_workspace_extra(&mut existing_extra)?;   // 同 §1.4 的弱校验
    }
    Some(serde_json::to_string(&existing_extra)?)
} else { None };
```

即**浅/深 merge（patch，不是替换）**，只需发 `{"extra":{"workspace":"/new/path"}}`，
其它 extra 键保留。

副作用：workspace 变更会**杀掉正在跑的 agent 运行时**（不是拒绝请求），
`service.rs:5040-5074` + `5147-5161`：

```rust
// A workspace repoint (e.g. binding a temporary session to a real
// project directory) changes the agent's cwd — and, via the surface
// scope, its native/gateway file authority. The cached agent baked the
// old cwd at build time, so it must be recycled ...
if model_changed || workspace_changed || delegation_policy_changed {
    Self::terminate_runtime_with_proof(
        runtime_registry, id,
        AgentKillReason::ConfigurationChanged,
        "conversation configuration update",
    ).await?;
}
```

`workspace_changed` 的判定是「请求里出现了 `workspace` 键 **且** merge 前后的
`extra.workspace` 字符串不同」。所以幂等重发同一路径不会误杀 agent。

PATCH 的限制/拒绝（全部在 `service.rs:4900-4997`）：

- 404：不存在或不属于当前 user。
- `ensure_not_retained_execution_attempt` / `ensure_no_ambiguous_edit_resubmit`：
  被 Execution Attempt 占用、或存在待定的 edit-resubmit 时报错（会话正忙的间接闸
  门；不是针对 workspace 的专门 409）。
- 400：`extra` 里带 `skills` / `preset_*` / `mcp_*` 快照键（创建后不可变）。
- 400：`extra` 里带 `BACKEND_OWNED_LIFECYCLE_EXTRA_KEYS`（`service.rs:13107-13118`：
  `_edit_resubmit_fence`、`turn_operation_id`、`execution_attempt_id` …）。
- 400：nomi 会话带 `extra.model`（要用顶层 `model`）；非 nomi 会话带顶层 `model`。
- 非 owner（非本机 authority）：`req.extra` 直接被置为 `None` 丢弃
  （`service.rs:4911-4925`）——也就是说远端/受限身份改不动 workspace，会静默无效。

**⚠️ 关键限制：临时会话无法通过 PATCH 变成项目会话。**
`rebase_managed_workspace_in_row`（`service.rs:12834-12851`）在 `get` / `list` 的每
次读取时执行：

```rust
if !temp_workspace_marker_present(&extra) { return Ok(()); }
let workspace = auto_workspace_path_for_row(workspace_root, row, &agent_type, &extra)?;
extra["workspace"] = json!(workspace.to_string_lossy());
```

只要 `extra` 里**存在 `temp_workspace_id` 键**，读取时 `extra.workspace` 就被无条件
重写回 `{work_dir}/conversations/{temp_workspace_id}`。所以对自动工作区会话 PATCH
`extra.workspace` 会：DB 写成功、PATCH 响应甚至可能回显新值（`update` 末尾
`service.rs:5170` 走的是不带 rebase 的 `row_to_response`），但**下一次 GET/list 就被
还原**。测试固化了这个行为：`service_test.rs:11183-11238`
`build_runtime_options_rebases_managed_workspace_after_restore`。

而「顺手清掉 marker」会**把会话搞坏**：`merge_json`（`service.rs:13218-13224`）是
朴素的 `insert`，**不删 null 键**：

```rust
fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (Some(base_obj), Some(patch_obj)) = (base.as_object_mut(), patch.as_object()) {
        for (key, value) in patch_obj { base_obj.insert(key.clone(), value.clone()); }
    }
}
```

发 `{"extra":{"temp_workspace_id":null}}` 之后：`temp_workspace_marker_present` 仍
为 true（`contains_key`），但 `require_temp_workspace_id`（`service.rs:12758-12773`）
拿不到字符串 → 返回 `AppError::Internal` → **该会话之后每次 GET/list 都 500**。
不要这么做。

所以正确用法是：**PATCH 只用于「已有项目会话」换到另一个真实目录**（这类会话没有
`temp_workspace_id` marker，rebase 直接 return）。把临时会话转成项目会话请**新建会
话**——这也是桌面 UI 的做法。

## 4. 会话列表中的项目分组

唯一的分组算法：`ui/src/renderer/pages/conversation/SessionList/utils/workpathTree.ts`
（135 行，`buildWorkpathTree`）。两层树：**workpath 节点 → (交互会话 | 终端会话)**。

### 4.1 归属规则

```ts
// 交互会话（workpathTree.ts:85-98）
const key = extra.custom_workspace === true && typeof extra.workspace === 'string'
  ? workpathKey(extra.workspace)
  : DEFAULT_WORKPATH_KEY;

// 终端（workpathTree.ts:99-111）
const key = t.is_default_workpath ? DEFAULT_WORKPATH_KEY : workpathKey(t.cwd);
```

**注意这里读的是 `extra.custom_workspace`，而服务端创建时会把它删掉。** 缺口由前端映
射层补：`ui/src/common/adapter/apiModelMapper.ts:197-204`

```ts
if (extra && !('custom_workspace' in extra)) {
  const workspace = typeof extra.workspace === 'string' ? extra.workspace : '';
  const isTemporary = extra.is_temporary_workspace === true;
  extra = { ...extra, custom_workspace: workspace.length > 0 && !isTemporary };
}
```

**手机端要复制的判定就是这一行：**

```
isProjectSession = extra.workspace 非空 && extra.is_temporary_workspace !== true
```

`is_temporary_workspace` 由服务端每次读取时派生注入（§1.3），所以这个判定不需要额外
接口。

### 4.2 key 归一化

`SessionList/utils/workpathKey.ts`（全文 16 行）：

```ts
export const DEFAULT_WORKPATH_KEY = '__default__';

export function workpathKey(path: string | undefined | null): string {
  const trimmed = (path ?? '').trim();
  if (!trimmed) return DEFAULT_WORKPATH_KEY;
  const slashed = trimmed.replace(/\\/g, '/');
  if (slashed === '/') return '/';
  return slashed.replace(/\/+$/, '');
}
```

即：反斜杠→正斜杠、去尾斜杠、空 → `'__default__'` 哨兵。**大小写敏感、不做
canonicalize** —— 同一目录的两种写法会分成两个节点。

### 4.3 显示名

`workpathTree.ts:66-68`：

```ts
displayName: key === DEFAULT_WORKPATH_KEY ? key : (key.split('/').filter(Boolean).pop() ?? key),
```

**非 default 节点显示 basename**（末段目录名）；default 节点先放哨兵字符串、由 UI 层
换成 i18n 文案。同名 basename 的两个项目会显示成两个同名抽屉（UI 未去歧义）。

### 4.4 排序

组内（`workpathTree.ts:113`）：

```ts
Number(b.pinned) - Number(a.pinned) || (a.pinned ? b.pinnedAt - a.pinnedAt : 0) || b.activityAt - a.activityAt
```

置顶优先 → 置顶内 `pinnedAt` 倒序 → 其余 `activityAt`（会话用 `modified_at`，终端用
`updated_at`）倒序。

节点间（`workpathTree.ts:124-133`）：置顶 workpath 按 `pinnedWorkpathKeys` 的**给定顺
序** → default 节点 → 其余按节点内最大 `activityAt` 倒序。节点的 `activityAt` =
组内所有条目 activityAt 的 max（`:120`）。

### 4.5 「同一项目下多个会话」

就是同一个 `WorkpathNode` 的 `interactive: []` 数组多于一条，UI 以可折叠抽屉呈现，抽
屉内还分 interactive / terminal 两个子组。抽屉上的「+」按项目路径继续新建
（`SessionList/index.tsx:312-322`）。default 节点恒存在（`workpathTree.ts:78`）。

### 4.6 空项目节点

`emptyWorkpaths` 参数（`workpathTree.ts:59, 80-83`）让「选了目录但还没建会话」的项目
也显示出来。来源是**纯 localStorage**：
`SessionList/utils/projectWorkpaths.ts:9`
`PROJECT_WORKPATHS_STORAGE_KEY = 'nomifun:session-list-project-workpaths'`，
配 `addProjectWorkpath` / `removeProjectWorkpath` / `subscribeProjectWorkpaths`。
`SessionList/index.tsx:94` 读它。**没有服务端接口** —— 手机端要么自己在本地存一份，要
么干脆不做空项目节点（推荐后者）。

同源工具（供别处复用同一规则）：`SessionList/utils/sessionWorkpath.ts` 的
`workpathKeyForConversation(extra)` / `workpathKeyForTerminal(session)` /
`workpathKeyForDraftDir(dir)`。

## 5. workspace 空 vs 非空的行为差异

### 5.1 运行期解析：空 workspace 一定会被替换成真实目录

`crates/backend/nomifun-conversation/src/service.rs:12171-12194`
（`build_runtime_options`）：

- 有 `temp_workspace_id` marker → workspace 重算为
  `{work_dir}/conversations/{temp_workspace_id}`。
- 否则读 `extra.workspace`，非空则 `validate_runtime_workspace_path`（同 §1.4 的弱校
  验）后使用。
- **两者都没有 → `AppError::Internal`**（"conversation … has neither a custom
  workspace nor a canonical temp_workspace_id"）。

agent 工厂再兜一层，`crates/backend/nomifun-ai-agent/src/factory/context.rs:34-50`：

```rust
let (workspace, is_custom_workspace) = if options.extra.get(TEMP_WORKSPACE_ID_EXTRA_KEY).is_some()
    || options.workspace.trim().is_empty()
{
    let temp_workspace_id = temp_workspace_id_for_options(options)?;
    let dir = deps.work_dir.join("conversations").join(temp_workspace_id);
    std::fs::create_dir_all(&dir)?;            // ← 只有自动工作区会 mkdir
    (dir.to_string_lossy().into_owned(), false)
} else {
    (options.workspace.clone(), true)
};
```

**所以 agent 永远有一个实际存在的 cwd。空 workspace ⇒
`{work_dir}/conversations/{uuidv7}/`，目录在首次构建 agent 时被创建。**
`work_dir` 默认与 data_dir 分离（e2e 断言见
`crates/backend/nomifun-app/tests/work_dir_e2e.rs:44-53`：自动工作区必须在 work_dir 下
且不在 data_dir 下）。

**自定义 workspace 不会被 mkdir。** 如果手机端传了不存在的路径，创建会话会成功
（§1.4），但首条消息时进程 spawn（`Command::current_dir` / PTY cwd）会因 cwd 不存在而
失败。手机端**必须自己保证目录存在** —— 用 `POST /api/fs/directory` 建，或只允许从
`/api/fs/browse` 的结果里选。

### 5.2 agent 的可写范围：workspace **不是**沙箱

`crates/backend/nomifun-ai-agent/src/factory/nomi.rs:662-671`：

```rust
// 原生文件工具写根：本地桌面全权（None），渠道会话收窄到工作区。
write_root: if is_instance_owner {
    resolve_native_write_root(overrides.channel_platform.as_deref(), &ctx.workspace)
} else {
    Some(ctx.workspace.clone())
},
```

`resolve_native_write_root`（`nomi.rs:1057-1072`）：

```rust
let is_channel = channel_platform.map(str::trim).is_some_and(|s| !s.is_empty());
if !is_channel { return None; }                 // ← 桌面 owner = 不钳制
let ws = workspace.trim();
if ws.is_empty() { None } else { Some(ws.to_owned()) }
```

结论：

| 调用者 | 原生 Write/Edit/ApplyPatch 写根 |
|---|---|
| instance owner + 无 channel_platform（桌面/手机以 owner 身份） | `None` = **不钳制，OS 用户全权** |
| owner + 带 channel_platform（IM 渠道转发的一轮） | 收窄到 workspace（workspace 空则退回不钳制） |
| 非 owner（受限身份） | 强制 `Some(workspace)` |

gateway 侧的 MCP 文件工具同一信任模型，
`crates/backend/nomifun-gateway/src/caps_files.rs:128-133`：

```rust
fn file_authority(ctx: &CallerCtx) -> Option<PathAuthority> {
    match ctx.surface() {
        Surface::Desktop => Some(PathAuthority::Unrestricted),
        Surface::Channel | Surface::Remote => None,   // → 默认 allowed_roots 收敛
    }
}
```

**因此「不填路径」并不带来任何额外的安全约束** —— 以 owner 身份跑的 agent 无论有没有
项目目录都能读写 OS 用户能碰的一切。workspace 的意义是 **cwd + 侧栏归属 + 提示语上下
文**，不是权限边界。手机端不填路径是安全的（等价于桌面的普通会话），填路径也不会更危
险。

### 5.3 终端 cwd

终端是独立资源，cwd **不从会话 extra 继承**：`CreateTerminalRequest.cwd` 是必填
（`crates/backend/nomifun-api-types/src/terminal.rs:64-70`，没有 `#[serde(default)]`）。
响应里 `is_default_workpath` 同样是每次读取派生的（`terminal.rs:33-38`：cwd 等于或位
于 work_dir 之下），逻辑对应会话的 `is_temporary_workspace`
（派生实现 `crates/backend/nomifun-terminal/src/types.rs:155-177`）。

桌面从项目抽屉建终端时把 workpath 作为 cwd 传进去
（`SessionList/index.tsx:325-333`，`state: { cwd: node.key }`）。手机端若要做项目终
端，同样自己把 workspace 传成 `cwd`。

### 5.4 其它由 workspace 决定的东西

- **首条消息注入模式**：`crates/backend/nomifun-ai-agent/src/capability/first_message_injector.rs:24-39`
  —— `use_native = native_skill_support && !custom_workspace`。自定义 workspace 强制走
  heavy 模式（把技能内容注入 prompt），因为用户目录**不允许被写入 symlink**。
- **技能 symlink**：只在自动工作区里做（`service.rs:4564-4588`，条件
  `!is_custom_workspace`）。注释："user-chosen paths must not be mutated"。
- **知识库绑定**的作用域单位就是 workpath
  （`crates/backend/nomifun-knowledge/src/workpath.rs:48`，同一 workpath 下所有会话共
  享一份绑定）。
- **历史产物校验根**：`history_artifact_workspace`（`service.rs:12791-12812`）。

## 6. default_files

- 声明在前端类型里：`ui/src/common/adapter/ipcBridge.ts:3005` `default_files?: string[]`。
- 唯一的写入方是 `/guid` 的发送流程：`useGuidSend.ts:209 / 275 / 338 / 432`
  `default_files: files`，`files` 就是用户在新建向导里挂的附件绝对路径列表；同一批
  `files` 还会作为**首条消息的 `files`** 一起发出去（`useGuidSend.ts:243` 等）。
- **`grep -rn "default_files" crates/` 结果为空 —— 后端从不读它。** 它只是被原样存进
  `conversation.extra` 的一份前端记录。
- **手机端不用管。** 传空数组、或干脆不传，行为完全一致。附件走
  `POST /api/conversations/:id/messages` 的 `files` 字段
  （`crates/backend/nomifun-api-types/src/conversation.rs:104-133`）。

## 7. 最近使用的工作目录

**服务端没有。** `ui/src/common/config/configKeys.ts` 里跟 workspace 相关的键只有
`'workspace.pasteConfirm': boolean`（`:62`），没有任何 recent/workpath 键。

桌面完全靠 localStorage，两份独立列表：

| 用途 | key | 文件 |
|---|---|---|
| 最近使用的工作目录（最多 5 条，LRU） | `nomifun:recent-workspaces` | `ui/src/renderer/components/workspace/recentWorkspaces.ts:7-8` |
| 侧栏「空项目」节点（选了目录但还没建会话） | `nomifun:session-list-project-workpaths` | `ui/src/renderer/pages/conversation/SessionList/utils/projectWorkpaths.ts:9` |

`recentWorkspaces.ts` 全文就是两个函数：

```ts
export const DEFAULT_RECENT_WS_KEY = 'nomifun:recent-workspaces';
const MAX_RECENT_WORKSPACES = 5;
export const getRecentWorkspaces = (storageKey = DEFAULT_RECENT_WS_KEY): string[] => { ... };
export const addRecentWorkspace = (path: string, storageKey = DEFAULT_RECENT_WS_KEY): void => {
  const prev = getRecentWorkspaces(storageKey);
  const next = [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
  localStorage.setItem(storageKey, JSON.stringify(next));
};
```

消费方：`GuidWorkspaceFootnote.tsx`（新建向导底部的工作目录选择器，`:58/:72/:83/:135`）
和 `WorkspaceFolderSelect.tsx`。

**手机端的现成免费替代**：不用自己维护 recent 列表也能给出候选 ——
`GET /api/conversations` 拉列表，取所有 `extra.is_temporary_workspace !== true &&
extra.workspace` 非空的会话，按 `modified_at` 倒序去重，就是「最近用过的项目目录」。
这正是 `buildWorkpathTree` 节点排序的等价物（§4.4），且天然跨设备同步。

## 8. 手机端最小实现建议

### 8.1 一句话结论

「项目会话」在协议层**只有一个字段**：`extra.workspace`（非空绝对路径）。手机端已有的
HTTP 层足够，不需要任何新后端能力。桌面唯一不可移植的部分是 Tauri 原生目录选择器，用
现成的 `GET /api/fs/browse` 替掉即可。

### 8.2 必须做（3 件事）

1. **创建项目会话**：在现有 create 流程上多一个可选路径参数。

   ```jsonc
   POST /api/conversations
   { "type": "nomi", "name": "<项目名，建议取 basename>", "model": { ... },
     "extra": { "workspace": "/home/rika/src/foo" } }
   ```

   不传 `custom_workspace`（服务端会删）、不传 `default_files`（后端不读）。
   不填目录就是 `"extra": {}`。

2. **目录选择器**：`GET /api/fs/browse?path=<dir>&showFiles=false` 逐层浏览。
   - 起始：`path=""`（Unix 得到后端进程 cwd；想更可预期就直接传用户家目录）。
   - 用响应的 `canGoUp` / `parentPath` 做返回；`items` 里 `isDirectory` 的才可进入。
   - `truncated: true` 时提示「目录过大，仅显示前 500 项」。
   - 需要新建文件夹：`POST /api/fs/directory` `{ parentPath, name }`（仅一级）。
   - **一定要走这个接口选路径，不要让用户手打** —— 服务端不校验路径存在性，手打错路径
     会造成「会话能建但一发消息就炸」。

3. **列表里认出项目会话并分组**：复制 `apiModelMapper.ts:197-204` 的判定

   ```ts
   const isProject = typeof extra.workspace === 'string'
     && extra.workspace.length > 0
     && extra.is_temporary_workspace !== true;
   const key = isProject ? workpathKey(extra.workspace) : '__default__';
   ```

   `workpathKey` 就是 16 行（§4.2），照抄。分组显示名取 `key.split('/').pop()`
   （basename），排序按组内最大 `modified_at` 倒序。

### 8.3 建议做

- **「最近项目」候选**直接从 `GET /api/conversations` 派生（§7 末），不要在手机本地另
  存一份 —— 免同步、免过期。
- **改工作目录**：只对已经是项目会话的会话开放
  `PATCH /api/conversations/:id` `{"extra":{"workspace":"/new"}}`，并提示用户
  「会重启该会话的 agent」。

### 8.4 明确不要做

- ❌ **不要**试图把自动工作区会话（`is_temporary_workspace === true`）PATCH 成项目会
  话 —— 会被 rebase 静默还原（§3）；顺手清 `temp_workspace_id` 会让该会话之后每次
  GET/list 都 500。要转就**新建会话**。
- ❌ **不要**发 `custom_workspace`（被删）、`temp_workspace_id`、`is_temporary_workspace`
  （创建时被删；PATCH 时前者会把会话搞坏）。
- ❌ **不要**实现 `default_files`（§6）。
- ❌ **不要**实现「空项目节点」（选了目录还没建会话就先在侧栏占位）—— 这是桌面
  localStorage 的本地体验糖（§4.6），没有服务端表示，跨端做不了一致。手机端让
  「选目录 → 直接建会话」一步完成即可。
- ❌ **不要**做 `~` 展开、相对路径、路径 canonicalize 的客户端猜测 —— 服务端不做规范
  化，一切以 `/api/fs/browse` 返回的 `path` 原样为准。

### 8.5 端到端最小流程

```
[项目列表页]
  GET /api/conversations  → 按 §8.2-3 分组
[新建项目]
  GET /api/fs/browse?path=/home/rika        → 选目录（可 POST /api/fs/directory 新建）
  POST /api/conversations {type,name,model,extra:{workspace:<选中 path>}}
  POST /api/conversations/:id/messages {content, files?}
[项目下再开一个会话]
  同上，workspace 复用同一路径 → 自动落进同一分组
```

## 9. 风险与待验证

- `/api/fs/*` 全部挂在 `protect_instance_owner` 之后
  （`crates/backend/nomifun-app/src/router/routes.rs:773-780`）。手机端的 Bearer 必须
  是 **instance owner** 身份；若用的是伙伴/受限 token，`/api/fs/browse` 会 403，目录选
  择器直接不可用。**上手第一步就该验这个。**
- `/api/fs/browse` 在 Unix 上把 `/` 放进 allow-list（`browse.rs:52-58`），等于整个文件
  系统可浏览。产品上可能需要在手机 UI 侧自行限制起始目录（例如只从家目录开始）。
- 非 owner 身份 PATCH 时 `req.extra` 被静默丢弃（`service.rs:4911-4925`）—— 改目录会
  「成功但没生效」。需要区分身份后再暴露该功能。
- 传入不存在的目录：创建会话成功，发消息才失败。错误信息来自进程 spawn 层，可能不友
  好。建议手机端在 POST 前用 `GET /api/fs/browse?path=<选中路径>` 探一下（能列出即存
  在）。
- 路径段首尾空白会被拒（`AppError::WorkspacePathEdgeWhitespace`，
  `crates/backend/nomifun-common/src/error.rs:154-164`）。从 `/api/fs/browse` 选出来的
  路径理论上也可能命中（目录名本身带尾空格），需要把这个错误码映射成可读提示。
- `workpathKey` 大小写敏感且不做 canonicalize：`/home/a/proj` 与 `/home/a/proj/` 会归
  一（去尾斜杠），但 `/home/a/./proj` 或符号链接路径会分成两个组。只从 browse 结果取
  路径可以规避。
- `type: "remote"` 的会话不支持 workspace（MCP 层显式报错，
  `caps_conversation.rs:474-477`）。REST 层未见同等校验，手机端自己别给 remote 会话传
  workspace。
