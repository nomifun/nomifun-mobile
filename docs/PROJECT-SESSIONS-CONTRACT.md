# 项目会话（绑定工作目录的会话）实现契约

> 取代本文件早期基于 `/api/conversations` 的版本 —— desktop 重构后（nomi-core）
> 会话的 canonical 资源是 **AgentSession**，`/api/conversations/*` 已退役。
> 协议事实以 `crates/backend/nomifun-app/src/router/nomi_core_session.rs` 为准。

## 协议事实（不要再推导）

- **项目会话 = `extra.workspace` 非空且非临时工作区**。协议层没有 project 表、没有
  project_id。
- 客户端判定（服务端不回 `custom_workspace`，必须自己派生）：

  ```ts
  const isProject = !!extra?.workspace && extra.is_temporary_workspace !== true;
  ```

- 创建：`POST /api/agent-sessions`
  `{preset_id, title?, model?:{provider_id,model}, workspace?:'<绝对路径>'}`。
  `workspace` 在创建时冻结为 Workspace resource binding，**之后不可改绑**
  （没有对应 PATCH 语义，不要再造 `extra.workspace` 更新入口）。
- `extra.workspace` 仍作为行投影的一部分返回（`GET
  /api/agent-sessions/{id}/projection` 的 `ConversationResponse.extra`）。
- 工作区浏览：`GET /api/agent-sessions/{id}/workspace?path=<rel>`（目录不存在 →
  404，按「无工作区」处理）；读文件走 `/api/fs/read`，以 workspace 根为 sandbox。
- 路径首尾空白会被 400（`WORKSPACE_PATH_EDGE_WHITESPACE`），提交前 `trim()`。
- 路径必须来自 `/api/fs/browse`：服务端不接受不存在的目录。
- workspace **不是沙箱**：agent 以安装所有者身份运行，UI 文案不得暗示
  「只能在该目录内操作」，只能说「以此目录为主工作区」。

## 单元接口（跨单元边界）

`src/features/fs/components/directory-picker.tsx`（目录选择器）与
`src/features/fs/api.ts`（browse/resolve/systemInfo）的对外签名维持不变。

`src/features/sessions/workpath.ts`：

```ts
export function workpathKey(workspace?: string | null): string;
export const DEFAULT_WORKPATH_KEY = '__default__';
export function isProjectConversation(c: Conversation): boolean;
export function workspaceDisplayName(workspace: string): string;
```

## 分工（越界即冲突）

| 单元 | 拥有 |
|---|---|
| 目录选择器 | `src/features/fs/**`、`src/i18n/locales/*/fs.json` |
| 列表分组 | `src/features/sessions/workpath.ts`、`hooks.ts`、`components/session-row.tsx`、`components/project-section.tsx`、`src/app/(app)/(tabs)/index.tsx` |
| 创建与面板 | `src/features/projects/**`、`src/app/(app)/session/new-project.tsx`、`src/app/(app)/session/[id].tsx`、`src/features/sessions/api.ts` |
