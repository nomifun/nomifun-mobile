# 项目会话（带工作目录的会话）实现契约

三个并行实现单元之间的接口约定。**先读 `docs/research/project-sessions.md`、
`fs-browse-api.md`、`workspace-runtime.md`**，本文只固定跨单元边界。

## 协议事实（不要再推导）

- **项目会话 = `extra.workspace` 非空**。协议层没有 project 表、没有 project_id。
- 客户端判定（服务端不返回 `custom_workspace`，必须自己派生）：
  ```ts
  const isProject = !!extra?.workspace && extra.is_temporary_workspace !== true;
  ```
- 创建：`POST /api/conversations {type:'nomi', name, model?, extra:{workspace:'<绝对路径>'}}`
  - **绝不发** `custom_workspace`（服务端剥离）、`temp_workspace_id`、
    `is_temporary_workspace`、`default_files`（后端从不读）、`merge_extra`
    （顶层 `deny_unknown_fields`，会 400）。
  - 普通会话仍然 `extra: {}`，后端自动开临时工作区。
- 改目录：`PATCH /api/conversations/:id {extra:{workspace:'/abs'}}`（extra 是 merge 语义）
  - **只允许对已经是项目会话的行操作**。对临时工作区会话无效（每次读取会被
    rebase 还原），而"顺手清 temp_workspace_id"会让该会话之后每次 GET 都 500。
  - 改动会终止该会话的 agent runtime（下一条消息才生效）→ UI 必须提示。
- 服务端**不校验路径存在性**、不 mkdir、不展开 `~`、不规范化。传错路径会
  「会话建成功、发第一条消息才炸」→ 所以路径必须来自 `/api/fs/browse` 的
  `currentPath`，或手输后先过 browse 校验。
- 路径段首尾空白会被 400（`WorkspacePathEdgeWhitespace`）。
- workspace **不是沙箱**：以安装所有者身份运行时 agent 不受写根钳制。UI 文案
  不能暗示"限制在该目录内"，只能说"agent 将以此目录为主工作区"。

## 单元 1 拥有的对外接口（单元 3 依赖它）

`src/features/fs/components/directory-picker.tsx` 必须导出：

```ts
export interface DirectoryPickerProps {
  visible: boolean;
  onClose: () => void;
  /** 用户确认选定目录时回调；path 一定是服务端 canonical 绝对路径 */
  onPick: (path: string) => void;
  /** 可选：打开时的起始目录（如上次选过的项目路径）；缺省从家目录开始 */
  initialPath?: string;
  /** 可选：额外的快捷入口（如「最近项目」），显示在起始屏 */
  shortcuts?: { label: string; path: string }[];
}
export function DirectoryPicker(props: DirectoryPickerProps): React.ReactElement | null;
```

`src/features/fs/api.ts` 必须导出：

```ts
export interface BrowseEntry { name: string; path: string; isDirectory: boolean; isFile: boolean; size?: number; modified?: number }
export interface BrowseResult { currentPath: string; parentPath?: string; items: BrowseEntry[]; canGoUp: boolean; truncated: boolean; isRoot?: boolean }
export function browseDirectory(path?: string, showFiles?: boolean): Promise<BrowseResult>;
export function createDirectory(parentPath: string, name: string): Promise<BrowseEntry>;
/** 校验用户手输路径；成功返回 canonical 路径，失败抛带可读 message 的 Error */
export function resolveDirectory(input: string): Promise<string>;
export function systemInfo(): Promise<{ work_dir?: string; platform?: string }>;
```

## 单元 2 拥有的对外接口（单元 3 只读使用，不修改）

`src/features/sessions/workpath.ts`：

```ts
/** 桌面 workpathKey 的逐行移植：`\` → `/`、去尾斜杠、空 → '__default__' */
export function workpathKey(workspace?: string | null): string;
export const DEFAULT_WORKPATH_KEY = '__default__';
/** 服务端不返回 custom_workspace，这是唯一判定入口 */
export function isProjectConversation(c: Conversation): boolean;
/** 取展示名：basename；同名时可带父目录 */
export function workspaceDisplayName(workspace: string): string;
```

## 分工与文件归属（越界即冲突）

| 单元 | 拥有 |
|---|---|
| 1 目录选择器 | `src/features/fs/**`、`src/i18n/locales/*/fs.json` |
| 2 列表分组 | `src/features/sessions/workpath.ts`、`src/features/sessions/hooks.ts`、`src/features/sessions/components/session-row.tsx`、`src/features/sessions/components/project-section.tsx`、`src/app/(app)/(tabs)/index.tsx`、`src/i18n/locales/*/sessions.json` |
| 3 创建与管理 | `src/features/projects/**`、`src/app/(app)/session/new-project.tsx`、`src/app/(app)/session/[id].tsx`、`src/features/sessions/api.ts`、`src/i18n/locales/*/project.json` |

共享文件（`src/api/**`、`src/components/ui/**`、`src/i18n/index.ts`、
`(app)/_layout.tsx`、`(tabs)/_layout.tsx`、`package.json`）任何单元都不要改；
`fs` 与 `project` 两个 i18n 命名空间已注册好，直接填 JSON 即可。
