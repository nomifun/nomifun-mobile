# nomifun-mobile

Nomifun 的手机端（Android / iOS / H5），基于 **Expo (React Native)**。

手机是"遥控器"：所有引擎执行、24h 持续工作都由 **Nomifun 桌面端** 承担，
手机通过局域网直连桌面端的 WebUI HTTP/WS API，与桌面状态完全互通，并增强
移动场景能力（扫码连接、完成通知）。

## 功能

| 模块 | 说明 |
|---|---|
| 会话 | 会话列表、聊天详情、流式回复、发送/停止、重命名/置顶/删除 |
| 定时任务 | 任务列表、启停、立即运行、运行历史、创建 |
| 需求平台 | 需求列表（按状态筛选）、详情、状态流转、创建、关联会话跳转 |
| 桌面伙伴 | 伙伴花名册、状态、身份/人设编辑 |
| 模型管理 | 供应商与模型、连通性、默认模型 |
| 客服 | 客服员工配置、笔记、访客对话监控 |
| 通知 | 会话回复完成 / 定时任务完成 / 需求完成的本地通知（H5 为浏览器通知） |

## 架构

```
┌──────────────┐   HTTP /api/* (Bearer JWT + CSRF 双提交)   ┌──────────────────┐
│ nomifun-mobile│ ◄────────────────────────────────────────► │ Nomifun 桌面端    │
│ (Expo RN App) │   WS /ws ({name,data} 信封, JWT subprotocol)│ (内嵌 WebUI 服务器)│
└──────────────┘                                            └──────────────────┘
```

- 连接方式一（推荐）：桌面端「开放能力 → WebUI 远程访问」开启后，App 扫描面板
  二维码（`http://<ip>:25808/qr-login?token=…`），一次性 token 换 30 天 JWT。
- 连接方式二：手输 `IP:端口` + 用户名密码（密码显示在桌面端面板上）。
- H5 形态必须与服务端**同源**部署/代理（浏览器跨域 Cookie 限制），开发期由
  `scripts/dev-proxy.mjs` 合并到同一端口；原生 App 无此限制，直接绝对地址访问。
- 服务端契约调研笔记见 `docs/research/`（端点、WS 主题、认证细节均有出处）。

## 开发（Ubuntu，H5 优先）

先起一个 nomifun 服务端（二选一）：

```bash
# A. 无头服务器（开发推荐，桌面仓库内）：
cd ~/src/nomifun-tauri
NOMIFUN_DATA_DIR=/tmp/nomifun-dev cargo run -p nomifun-web -- --port 8787 --api-only \
  --admin-password 'dev-Password1'

# B. 或运行 Nomifun 桌面端，并打开「WebUI 远程访问」（端口 25808），
#    然后 NOMIFUN_SERVER=http://127.0.0.1:25808 指向它。
```

再启动移动端 H5：

```bash
bun install
bun run dev        # = Expo web (8081) + 开发代理 (8788，绑 0.0.0.0)
```

浏览器/手机访问 `http://<本机IP>:8788`，用密码登录即可。
环境变量：`NOMIFUN_SERVER`（默认 `http://127.0.0.1:8787`）、`PORT`（默认 8788）。

> ⚠️ 登录接口有限流：**15 分钟内 5 次失败**即锁定，调试时别反复试错密码。

## 真机 / 打包

iOS、Android 的权限与网络配置已就绪（相机扫码、通知、明文 HTTP 局域网访问、
iOS 本地网络描述），无需再改原生配置：

```bash
bun run android          # 本地调试（需 Android SDK / 模拟器或真机）
bun run ios              # 需 macOS
bun x eas build -p android --profile preview   # 云端打 APK
bun x eas build -p ios --profile preview       # 云端打 iOS（需 Apple 账号）
bun run export:web       # 导出 H5 静态产物 (dist/)，部署时与服务端同源反代
```

## 目录

```
src/api/          HTTP 客户端(Bearer+CSRF)、连接存储、WS 客户端、认证流程
src/app/          expo-router 路由（connect / scan 登录前；(app)/ 登录后）
src/components/ui 通用 UI 组件（主题化）
src/constants/    设计 token（色板与桌面端主题契约对齐）
src/features/     各功能域（api + hooks + 组件）
src/i18n/         中文优先的多语言资源
scripts/dev-proxy.mjs  H5 同源开发代理
docs/research/    桌面端 API/协议调研笔记（实现依据）
docs/FOUNDATION.md 基础设施契约
```

## 一期边界

- 仅局域网直连；`nomifun-net-infra` 公网中继暂未接入（手输地址已兼容自建
  `nomifun-web` 域名部署，协议一致）。
- 渠道机器人创建、知识库管理、MCP/技能、终端等重交互留在桌面端。
