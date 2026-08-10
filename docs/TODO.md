# nomifun-mobile 待办

本文件只记录**确实还没做、且已确认要延后**的事。做完的不留在这里；范围外的决策（例如手机端不做终端、渠道机器人不在手机端创建、workspace 不是沙箱）见 `docs/research/` 各功能文档的「故意没做」小节。

---

## 延后：原生端（Android / iOS）打包与真机验收

**状态**：代码层已完成，从未在真机上构建或运行过。当前开发机是 Ubuntu，iOS 无法构建、Android 真机调试不便，故整体延后。

已就绪的部分（不需要重做）：
- `app.json`：bundle id `fun.nomi.mobile`、相机与通知权限文案、iOS `NSLocalNetworkUsageDescription` + `NSAllowsLocalNetworking`（连局域网 IP 必需，最容易漏）、Android `usesCleartextTraffic`（桌面端 LAN 无 TLS）。
- `eas.json`：development / preview / production 三档。
- 扫码连接：`src/app/scan.tsx`（expo-camera，App 内置扫码器；**不能**走系统"扫码打开链接"，否则一次性 QR token 会被浏览器先消费掉）。
- 通知：`src/features/notifications/service.ts`（原生走 expo-notifications，H5 走 Web Notification）。

真机验收前必须补的：
1. **图标与启动图仍是 Expo 模板占位**（`assets/images/icon.png`、`splash-icon.png`、三张 Android adaptive 图层）。
2. **EAS 项目未创建**：`eas init` 拿到 projectId 后写入 `app.json` 的 `extra.eas.projectId`。
3. 真机验收清单：扫码连接、明文 HTTP 直连局域网 IP（Android 与 iOS 分别验）、通知权限弹窗与后台送达、点通知跳到对应会话、`AppState` 前后台切换后 WebSocket 是否重连（RN 的半开 socket 会一直报 OPEN，代码里已有 75s 陈旧看门狗）、**附件按钮在原生端只显示引导文案**（见下条）。
4. iOS 还需 Apple 开发者账号与 macOS（或用 EAS 云构建）。

命令：`bun x eas build -p android --profile preview` / `-p ios`。

## 延后：原生端选图上传

web 端附件已可用（`<input type=file>` → `POST /api/fs/upload` → 消息 `files`）。原生端目前只显示「请在网页版或桌面端添加附件」。要做需要：
- `expo-image-picker` 依赖 + iOS `NSPhotoLibraryUsageDescription` / Android 权限说明 → 触发原生重建；
- RN 的 FormData file 形状是非标准的 `{uri,name,type}`，web 与 native 会分叉两套上传代码；
- **HEIC 必须客户端转码**（服务端 `image_attachments.rs` 对 HEIC 是硬报错，会让整轮发送失败），要么让 picker 直接输出 jpeg，要么再加 `expo-image-manipulator`。

## 延后：跨公网中继（nomifun-net-infra）

**状态**：中继服务端本身还没开发好，手机端不做对接。

一期已为它留好路：连接页支持手输任意 `host:port`（含域名与 https），协议与局域网完全一致——用户自建 `nomifun-web` 或做端口转发时现在就能连上。真正接中继时预计只需在连接页多一种入口 + 中继侧身份换取，业务层与 WS 层不用动。

注意（`docs/research/connectivity.md`）：反向代理场景下 `/ws` 握手要求保留原始 `Host`，否则 403，症状是"一直显示执行中、刷新才更新"。

---

## 服务端能力缺失导致做不了的

- **定时任务的运行时长与输出**：`CronJobRunResponse` 只有 `{cron_job_run_id, cron_job_id, executed_at_ms, status}`，不返回耗时与输出摘要，且只保留最近 7 条（`CRON_RUN_HISTORY_LIMIT`）。手机端历史区块已如实标注。要补必须先动 `nomifun-cron`。
- **消息搜索不能按会话过滤**：`GET /api/messages/search` 只有 `keyword/page/page_size`，没有 `conversation_id`，所以只有全局搜索入口，会话内搜索做不了（且服务端是 LIKE 全表扫 + preview 拼整个 content JSON，`page_size` 不宜调大）。

## 评估后决定不做的

- **`GET /api/providers` 明文返回 api_key 改遮蔽**：端点已是 owner-only（`protect_instance_owner`），而连通性测试（`detect-protocol` / `fetch-models`）的请求 DTO 里 `api_key` 是必填 String——遮蔽后明文照旧要过网络，治不了根；改造成本 L（要新增 owner-only 明文读取端点，否则「显示当前密钥」「测试连接」「多密钥计数」三处功能回归）。设计方案已在评估记录里，将来若要做按那个方案走。
- **需求看板视图**：手机上现有的状态分段筛选（全部/待处理/进行中/待复核/已完成/失败/已取消 + 标签筛选 + 计数）已等价覆盖桌面看板的信息量，横向分栏在 390px 宽度下反而更难用。

## 可选的加固（有价值但非必需）

- **临时会话改绑目录**：服务端侧已在本轮修好（`retired_temp_workspace_id` 方案，绑定不再被 rebase 回滚），所以手机端"临时会话不提供改绑"这条限制**已不再是技术约束**，只是保守的产品选择。若想开放，把 `workspace-panel.tsx` 里对临时会话隐藏「更换工作目录」的分支去掉即可（服务端会自行退休 marker 并保留删除时的临时目录回收）。
- **工具审批的实时性**：`confirmation.add/update` 两个 WS 主题在服务端没有 emitter，手机端靠 `turn.started`/`turn.completed` 载荷里的 `runtime.pending_confirmations` 触发拉取。若将来服务端补上 emitter，可去掉这层间接。
- **模态背景 `inert` 加固**：三处 sheet（projects/companions/models）依赖 react-native-web 自带的 `role=dialog + aria-modal + 文档级 focus trap`（已实测有效、键盘 40 次 Tab 零泄漏）。若要更严格可在 sheet 可见时给 `#root` 加 `inert`，属双保险，收益有限。
