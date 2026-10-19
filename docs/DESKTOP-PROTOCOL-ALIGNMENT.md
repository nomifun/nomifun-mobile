# Mobile 与 Desktop 协议对接说明

本次对齐以 2026 年 10 月 16 日的 nomifun-desktop v0.8.11 为基准，提交 `965d819c8`，UI API contract version 为 `33`。现有 Mobile 需要修改：旧模型特性会被严格 DTO 拒绝，完整保存会清掉新增元数据，旧连接探测无法证明模型协议可用。相关 API、模型管理界面和模型选择器已完成接入。

## 模型管理差异及处理

| 范围 | 当前核心服务契约 | Mobile 处理 |
| --- | --- | --- |
| 模型数据 | `provider → models → capabilities`；保存模型为完整替换 | 创建、编辑、启停均保留别名、描述、排序和全部能力配置；响应中的健康信息和时间戳不会进入写请求 |
| 模型用途 | 新增 `music_generation` | 添加音乐用途、协议清单、能力编辑和中英文文案 |
| 用户可编辑特征 | 仅 `vision_input`、`web_search`、`audio_input`、`video_input`，且仅允许 Chat 声明 | 删除已退役的技术特征输入；非 Chat 写入空 traits |
| 运行时技术能力 | 工具调用、推理、流式输出的负面检测结果归 `health.unsupported_technical_capabilities` | 显示检测结果；需要技术能力的选择器按该事实过滤，缺失负面证据时保持乐观支持 |
| 输入能力选择 | 由已配置的 Chat adapter 决定输入编码能力 | 与 Desktop 的选择器规则一致，不根据模型名称猜测，也不因为缺少目录 traits 隐藏支持的 adapter |
| 模型别名 | `display_name` 与调用用的 `model` 分开 | 编辑及管理、默认模型、会话、伙伴、客服展示别名；所有命令继续发送模型 ID |
| 上下文及输出 | `context_limit`、`output_limit`、`compaction_threshold_pct`；上下文口径可为 input only 或 combined | 正整数校验；Chat 压缩阈值校验 50–95，缺省由服务端处理；完整保留上下文口径元数据 |
| 模型目录 | `tasks_source`、`output_limit`、`token_limit_sources`、`catalog_source` | 采用明确声明的用途与限制，展示限制及来源；不将推测的用途当作已确认能力 |
| 官方默认配置 | `/api/model-protocols` 按精确 model 返回 `model_defaults` | 每个模型独立请求；新模型可采用建议；已保存值、用户修改及明确清空不会被重新填入 |
| 自动值来源 | 文档、目录、用户输入的所有权不同 | 切换模型释放原模型自动值，切换协议释放协议专用自动参数；后到的供应商目录可替换仍由文档拥有的限制 |
| 协议发现 | 核心服务返回候选状态、证据和实际验证的完整 capability | 改为显式触发；展示可能计费提示；应用服务端返回配置后仍需保存；连接、模型、参数或账号变化使旧结果失效 |
| 连接探测 | `probe-connection` 仅代表端点可达性 | 保留为供应商连接诊断，明确提示其验证范围；移除以端点可达性自动认定模型协议可用的逻辑 |
| 模型网关 | 独立控制面及原子连接更新 | 支持运营方核对、目录选择导入、账户查询、同步和连接修改；禁用服务端不支持的普通连接编辑入口 |
| 网关数值 | 财务、配额及速率使用十进制字符串，支持完整 int64 范围 | 保持字符串，使用整数运算显示，区分缺失值和零 |
| 凭据 | 只写；修改时缺省表示保留；跨源网关修改要求新 key | 凭据只放请求正文；改变目标先清空旧输入、重取运营方；由核心服务校验和执行连接迁移 |
| 多端配置变化 | `providers.changed` | 刷新供应商、模型、连接及默认项；会话、客服等共用同一供应商缓存 |

Mobile 只负责表单、请求和状态展示。网关导入、同步合并、协议转换、Agent 验证、工具重放、模型调用和上下文压缩策略仍由核心服务执行。

## 关键接口

| 操作 | HTTP 接口 |
| --- | --- |
| 精确模型协议清单 | `GET /api/model-protocols?preset=…&task=…&model=…` |
| 新供应商草稿的协议发现 | `POST /api/providers/discover-model-protocols` |
| 已保存供应商的协议发现 | `POST /api/providers/:provider_id/discover-model-protocols` |
| 完整保存模型 | `PUT /api/provider-models` |
| 模型实际健康检查 | `POST /api/agents/provider-health-check` |
| 网关运营方及目录预览 | `POST /api/providers/model-gateway/meta`、`catalog` |
| 网关原子创建 | `POST /api/providers/model-gateway/create` |
| 已保存网关运营方及账户 | `GET /api/providers/:provider_id/model-gateway/meta`、`account` |
| 网关目录同步 | `POST /api/providers/:provider_id/model-gateway/sync` |
| 网关连接原子修改 | `PUT /api/providers/:provider_id/model-gateway/connection` |

API 请求地址继续遵守 H5 同源、Native 使用当前连接绝对地址的规则，没有新增固定服务端地址。

## 其他功能审计

现有 auth、连接身份与数据代际、HTTP 错误、WebSocket 认证与重连、会话和项目、定时任务、需求、文件、伙伴、客服及 voice v1 调用已与当前服务端逐项核对，未发现其他现有接口的破坏性差异。补齐以下会话行为：

- `tips.content` 为空时，仍展示 `user_input_request.question` 及 `remaining_work`。
- 展示服务端明确返回的取消、暂停和结果不可确认终态。
- 停止请求携带 `expected_turn_id`；HTTP 接收尚未返回时等待该次接收结果，并绑定原连接代际，防止延迟请求取消其他轮次。
- 新建时的默认模型由核心服务准备官方 Agent 的现役接口解析；Mobile 不再读取安装默认值并自行挑选或向两个创建请求重复注入模型。已准备的 Preset 与创建幂等键在回执未知时保持不变。
- `PUT /api/agent-sessions/:id/model` 同时支持既有无模型会话的首次绑定及更换模型。核心服务从原冻结 Revision/Snapshot 派生，保留资源、非模型配置与历史；相同有效配置重复选择不增加绑定版本。
- 模型绑定与不兼容推理强度的清理由核心服务原子提交。命令失败只反馈给发起操作，不写入 Mobile 的详情读取错误；成功响应直接更新共享会话实体，无需额外 GET 才能生效。

Desktop 新增的应用托管、浏览器、审批和知识回写管理界面属于新增产品能力，本次没有在 Mobile 新增这些页面。

Mobile 伙伴总览和设置现已复用现有 `PATCH /api/companion/companions/:id`，支持主对话、备用、视觉、语音识别、语音合成、学习和进化模型的选择、清除及回显，不需要修改 Desktop。每次只发送目标槽位，TTS 音色可明确设置、恢复供应商默认或保留；清除 ASR/TTS 恢复全局设置，清除独立视觉槽恢复主模型能力。修改伙伴默认不会切换已有 Session，当前会话模型仍通过现有聊天页修改。

模型候选使用共享供应商目录，区分未加载、空目录和请求失败；失效引用保留展示。伙伴写操作按当前连接代际串行执行，保存后以已确认 profile 更新显示并重取详情与列表；PATCH 返回值不冒充含 `status` 的详情。无调用的伙伴读取包装、旧模型展示 helper 和客服旧模型目录 API 已清理。复验命令和 UI fixture 的证明范围见 [TESTING.md](TESTING.md)。

## 代码入口

- `src/features/models/types.ts`：当前 DTO、manifest、目录和网关类型。
- `src/features/models/wire.ts`：严格写请求字段白名单。
- `src/features/models/protocol-api.ts`：可注入 transport 的协议发现及网关 API。
- `src/features/models/advanced.ts`、`protocol-discovery.ts`：表单序列化、校验及默认值来源。
- `src/features/models/components/`：模型编辑、协议发现及网关界面。
- `src/features/models/hooks.ts`、`selectors.ts`、`presentation.ts`：共享缓存、任务筛选和显示名称。
- `src/features/sessions/turn-cancel.ts`、`stream.ts`：按轮次取消和事件展示。

核心服务的权威定义在相邻 desktop 仓库的 `crates/backend/nomifun-api-types/src/{provider_model,model_task,model_protocol,model_protocol_discovery,model_gateway}.rs`；实际路由和校验在 `nomifun-system`。后续对齐应先核对这些定义，再核对 Desktop renderer 的调用，不从历史研究文档推导当前写协议。

## 验证结果和复验

本次本地验证通过：

- `bun run check`：TypeScript、526 个测试和 i18n 检查通过。Bun 中跳过的 8 项 Node 专用测试使用独立命令执行。
- `bun run export:web`：成功生成 52 条静态路由的 Web 导出。
- `bun run typecheck:e2e-models`：实服验收脚本独立类型检查。
- 隔离的实际 Desktop HTTP 服务：14 项端到端检查通过，包含协议发现、流式工具重放、健康检查、音乐任务、完整保存、严格拒绝及网关全部控制面。
- 网关同步保留用户别名、禁用状态、说明、排序、协议及预算；同源 key 保留和轮换、跨源必须新 key、迁移后的 OpenAI、Anthropic、Gemini 命名连接调用均通过。
- H5 界面：账号连接、创建供应商、别名、无效阈值阻止保存、启停后重开编辑保留限制和阈值、默认模型选择器及网关入口通过。

实服验收使用新建的数据目录和本机模拟上游；没有使用真实模型密钥或产生云端推理费用。它证明 Mobile 与当前核心服务的 HTTP 及序列化行为，不代表真实供应商在线可用性或 Android 和 iOS 真机验收。

复验使用独立、已启动的认证模式 `nomifun-web --api-only`，显式设置新的 `--data-dir`，并将 work、cache、log 目录隔离。随后执行：

```powershell
bun run check
bun run typecheck:e2e-models
bun run e2e:models -- --backend-url http://127.0.0.1:18787 --data-dir .tmp-e2e/model-alignment/data
bun run test:voice-web-server
bun run export:web
```

`e2e/models-contract.mts` 会验证目标仅为 loopback 且对应指定的数据目录，自动为新库执行 device setup，只创建和清理它自己持有的测试供应商。报告默认写入 `.tmp-e2e/model-alignment/model-contract-report.json`。测试账号及库保留供后续界面验收；上述路径属于忽略的测试产物。

Windows 上首次启动隔离服务遇到内置 skills 暂存目录重命名被拒绝，测试环境将同一次启动完整释放的目录复制为目标目录后正常启动。没有修改 Desktop 源码，也没有读取或迁移用户已有数据。
