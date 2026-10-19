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

- 创建：`POST /api/agent-sessions`，携带 `Idempotency-Key`，请求体为
  `{preset_id, title?, model?:{provider_id,model}, resource_selections?, workspace?:'<绝对路径>'}`。
  `workspace` 在创建时冻结为 Workspace resource binding，**之后不可改绑**
  （没有对应 PATCH 语义，不要再造 `extra.workspace` 更新入口）。
- `extra.workspace` 仍作为行投影的一部分返回（`GET
  /api/agent-sessions/{id}/projection` 的 `ConversationResponse.extra`）。
- 工作区浏览：`GET /api/agent-sessions/{id}/workspace?path=<rel>`（目录不存在 →
  404，显示目录不存在状态）；文件预览使用 `/api/fs/metadata`、`/api/fs/read`，
  请求携带 workspace 供文件接口校验读取范围。
- 路径首尾空白会被 400（`WORKSPACE_PATH_EDGE_WHITESPACE`），提交前 `trim()`。
- 路径必须来自 `/api/fs/browse`：服务端不接受不存在的目录。
- workspace **不是沙箱**：agent 以安装所有者身份运行，UI 文案不得暗示
  「只能在该目录内操作」，只能说「以此目录为主工作区」。

## 会话数据的唯一所有者

认证布局中的 `SessionDataProvider` 为当前连接 epoch 创建一个 `createSessionData`
实例。会话列表、侧栏、最近项目目录、语音会话选择器、会话详情投影共用它的实体 map。
页面通过 `useSessionData()`（或别名 `useSessionList()`）读取和执行命令；详情通过
`useSessionDetail(id)` 订阅同一实体。不要为项目创建另一份会话列表缓存。

- UI 命令统一为 `create(name?, {workspace?})`、`patch(id, updates)`、`remove(id)`、
  `setModel(id, selection)`。HTTP 适配器负责公开 AgentSession API、epoch 约束和响应校验。
- 创建以 POST 返回的 `{conversation_id, epoch}` 确认成功并导航。后续 projection
  失败显示读取错误并允许重试，不再报「创建失败」或重复提交新建请求；不确定结果的重试复用
  原 idempotency key 和请求体。
- `catalog.ts` 保存列表 ID 和会话实体，列表与详情从同一实体读取 runtime。详情读取可更新
  已加载行，也可缓存未在当前分页窗口中的实体，不会把详情 ID 自动插入列表。
- 刷新只重读首屏，成功后替换旧分页窗口；不等待历史页重读。分页同一时刻只运行一个请求，
  对 ID 去重并保留服务端返回顺序。请求期间的新变化触发补读，旧分页和旧连接响应不能回写。
- 最近项目快捷入口从当前已加载会话的 workspace 去重派生，最多展示五个目录。它不是完整
  历史项目索引；不需要另建 project 表或本地最近项目存储。
- 项目筛选同时排除伙伴专属会话；展示窗口按置顶、服务端活动字段及 ID 排序，原始服务端分页顺序独立保存。项目分组标题按活动字段排序，
  与目录实体及分页游标分离。
- `attachSessionSync` 先订阅再读快照。`ws.ready`、`ws.reconnected`、列表变更、Agent
  元数据变更、turn 生命周期和应用回前台统一触发 owner reconcile，弥补无事件重放的间隙。
- 合法空列表、协议错误、加载中和加载下一页分别表示。响应缺少 `items` 或格式不符时显示
  协议错误，不能通过 `items ?? []` 隐藏为「还没有会话」。

## 公开接口与展示派生

列表读取 `GET /api/agent-sessions?limit=<n>&cursor=<上页末行ID>`，返回
`{items: ConversationResponse[], total, has_more}`；单条展示读取
`GET /api/agent-sessions/{id}/projection`。裸资源路径返回的 canonical observation
不能当作展示行。历史消息使用 `/api/agent-sessions/{id}/message-history`，由聊天模块单独管理。

`src/features/fs/components/directory-picker.tsx`（目录选择器）与
`src/features/fs/api.ts`（browse/resolve/systemInfo）负责选择宿主目录。目录选择器提供的绝对路径
直接作为新建输入，服务端验证并冻结最终 Workspace binding。

`src/features/sessions/workpath.ts`：

```ts
export function workpathKey(workspace?: string | null): string;
export const DEFAULT_WORKPATH_KEY = '__default__';
export function isProjectConversation(c: Conversation): boolean;
export function workspaceDisplayName(workspace: string): string;
```

以上函数只派生展示信息，不改变 AgentSession 的业务状态或工作目录绑定。

## 原生模块图校验

`metro.config.js` 将 `swr` 和 `swr/*` 的公开 exports 统一到同一 CommonJS 模块族，再交由
Metro 解析。不要取消其他依赖的 package exports，也不要依赖 SWR 私有 `dist` 文件名。
会话目录虽有独立 owner，消息历史和其他功能仍使用 SWR，因此 provider、fetcher、cache 的模块
身份必须一致。

`tests/cache-module-identity.test.mjs` 使用真实 Metro resolver 和独立 Node 进程中的 React
provider/consumer 回归验证。涉及原生打包时，导出 Android JavaScript 和 sourcemap，再运行：

```sh
node scripts/check-cache-module-graph.mjs --compare --source-map /path/to/emitted/android/entry-HASH.js.map
```

检查要求实际导出只包含一套 SWR context，并验证 provider 与 consumer 继承同一个 fetcher、
cache 和 mutator。导出命令及本地验证方式见 [FOUNDATION.md](FOUNDATION.md)。

## Android 空列表的已验证根因

0.1.1 Android 包与原配置导出图中，根布局的 `swr` 主入口进入 ESM Context，
`swr/infinite` 子入口进入另一份 CommonJS Context。分页 hook 得不到根 provider 的
fetcher，因此不发送列表 HTTP 请求；其 `[undefined]` 结果被旧代码同时解释为空态和
“正在加载更多”。手动刷新无法修复缺失的 fetcher。

`metro.config.js` 从构建解析层保证单一实例；会话 owner 则通过显式、校验过的 HTTP
适配器读取，不再依赖 Infinite 聚合缓存的内部键。`check-cache-module-graph.mjs`
同时验证真实解析、React Context 穿透和可选的原生 sourcemap。

当前 Desktop 列表按 ID 游标分页；手机的展示排序只作用于已加载窗口，不声明全量历史
已按活动或置顶重新分页。当前 Desktop 投影中的 `modified_at`、`pinned_at` 不能被手机
补造。修改这项后端契约需要相应的 canonical 时间定义及分页协议验证，不应通过手机
生成另一份业务时间或保存第二套会话表。
