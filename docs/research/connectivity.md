# 手机如何连上桌面版 NomiFun（现状调研）

> 调研对象：`/home/rika/src/nomifun-tauri`（分支 main，`3bd9a566`）。
> 目的：为 nomifun-mobile 的「扫码连接」流程摸清现有服务端契约。全文只描述**当前代码里已有的东西**，
> 以及 mobile phase-1 会撞上的缺口。

---

## 1. 一句话总结

桌面 Tauri 应用**自带完整后端**（同一个 `axum` router，与无头 `nomifun-web` 共用一套代码）。
默认它只在一个随机的 loopback 端口上给自己的 webview 服务；用户在「开放能力」页手动打开
**WebUI 远程访问**开关后，同一个 router 会**额外**绑定 `0.0.0.0:25808`，此时局域网上的手机
才能访问。桌面面板会显示一个二维码，内容是一条一次性登录 URL；扫它就能拿到 30 天有效的 JWT。

没有 mDNS / UDP 广播 / 任何自动发现机制 —— 手机必须靠扫码或手输 IP:PORT 才知道桌面在哪。

---

## 2. 双监听器架构

源码：`crates/backend/nomifun-app/src/desktop.rs`

| 监听器 | 绑定 | 何时存在 | 认证方式 |
|---|---|---|---|
| loopback（常驻） | `127.0.0.1:<随机端口>` | 桌面进程整个生命周期 | 每次启动生成的 **local-trust 密钥**（HTTP 头 `x-nomi-local-trust`），桌面 webview 免登录 |
| LAN（按需） | `0.0.0.0:25808` | 仅当用户打开开关 | 必须登录（密码 或 二维码），拿 JWT / session cookie |

关键实现点：

- router 只构建一次（`DesktopServer.router`），两个 socket 共用（`desktop.rs:1180` 起 `self.router.clone()`）。
- 桌面后端跑在 `AuthPolicy::TrustLocalToken` 下（`desktop.rs:637`）。信任依据是**密钥**，
  **不是**「来自 loopback」——所以同机的其它 OS 账户 / 反向代理都不会被自动信任。
- 数据目录有独占锁（`{data_dir}/server.lock`），所以桌面在跑时**不可能**再起一个 `nomifun-web`
  指向同一数据目录。LAN 监听器就活在桌面进程里。
- LAN 监听器额外套了 `host_guard_middleware`（`desktop.rs:1710`）：`Host` 和 `Origin`
  必须是 IP 字面量或 `localhost`，否则 403（防 DNS-rebinding）。
  → **对 mobile 的影响**：原生 App 请求时如果带了自定义 `Origin`（比如 `capacitor://localhost`
  之外的域名形态），会被 403。原生客户端最好**不发 `Origin`**，`Host` 天然就是 `IP:25808`，没问题。

---

## 3. 端口

- 常量：`crates/backend/nomifun-app/src/desktop.rs:50` → `pub const WEBUI_LAN_PORT: u16 = 25808;`
  **Rust 侧没有 dev/prod 分支，永远先试 25808。**
- 端口占用时的回落：`crates/backend/nomifun-app/src/bootstrap/bind.rs:25` `bind_with_fallback`
  1. 先试 `25808`
  2. 失败则**确定性扫描** `25809 ..= 25824`（`SCAN_SPAN = 16`）
  3. 全占则用临时端口（`:0`）
- 前端 `WEBUI_DEFAULT_PORT`（`ui/src/common/config/constants.ts:20`）是 prod 25808 / dev 25809 /
  `NOMIFUN_MULTI_INSTANCE=1` 时 25810 —— 这只是 UI 在没拿到真实状态时的**兜底显示值**，
  真正的端口来自后端返回的 `status.port`。
- 对比：无头 `nomifun-web` 默认 `8787`（`--port` / `NOMIFUN_WEB_PORT`）。

**mobile 结论**：可以把 `25808` 当默认值预填，但**不能硬编码**——手输地址界面必须允许改端口，
二维码里带的端口才是权威值。

---

## 4. 桌面上怎么开启 LAN 服务

UI 入口：**开放能力**页，路由 `/open-capabilities`
（`ui/src/renderer/pages/openCapabilities/index.tsx:267` 渲染 `<WebuiControlPanel mode='page' />`）。
旧路由 `/settings/webui` 会 `Navigate` 重定向过去（`ui/src/renderer/components/layout/Router.tsx:220`）。

调用链：

```
Switch(onChange) → useWebuiServer().start()            ui/src/renderer/hooks/context/WebuiServerContext.tsx
                 → webui.start.invoke()               ui/src/common/adapter/ipcBridge.ts:2481
                 → Tauri command `webui_start`        apps/desktop/src/main.rs:902
                 → DesktopServer::start_lan()         crates/backend/nomifun-app/src/desktop.rs:1115
```

`start_lan()` 做的事（按顺序）：

1. 若已有 LAN listener 且不是「尸体」→ 直接返回现状。
2. **前置校验**：没有 SPA app shell（dev 代理 URL / 内嵌资源 / `ui/dist` 三者全无）就直接失败，
   不允许只暴露 API 不给页面。
3. **凭据兜底**：若 `has_users() == false`，生成 20 位随机密码，bcrypt 后写库，
   并把明文**只在这一次的返回值里**带出来（`initial_password`），永不进 status 广播频道。
   这一步是安全闸门：否则第一个访问 LAN 的人能用 `POST /api/auth/setup` 认领 admin。
   注意只填密码不填用户名 —— 用户可能在关闭状态下改过 admin 名。
4. 组装 LAN app = 共享 router + SPA fallback（dev 反代 vite / prod 内嵌资源 / `ui/dist`），
   再套 `host_guard_middleware`。
5. `bind_lan(25808)` → `0.0.0.0`。
6. 探测所有可用网卡 IPv4（`lan_endpoint.rs:238 detect_all_lan_ipv4s`，路由默认出口优先，
   私网地址排前面），生成 `network_urls`。
7. 广播 `WebUiStatus`（`running/port/allowRemote/localUrl/networkUrl/networkUrls/lanIP/adminUsername/passwordSet`）。

### 关键缺口：不会自动恢复

`WebuiServerContext.tsx:14` 定义了 `DESKTOP_WEBUI_ENABLED_KEY = 'webui.desktop.enabled'`，
`start()/stop()` 会把 `true/false` 写进 configService，`ui/src/common/config/configKeys.ts:41` 也声明了这个键 ——
**但全仓库没有任何地方读它**（grep 只有声明 + 写入两处）。

→ **每次桌面重启，LAN 监听器都是关闭状态，必须用户手动再打开一次。**
手机侧无法远程唤醒。这是 phase-1 最大的体验硬伤（见第 9 节）。

---

## 5. 二维码：确切的载荷格式

### 5.1 载荷就是一条 URL

生成逻辑：`ui/src/renderer/components/layout/Sider/webuiQrLinks.ts`

```ts
export const buildWebuiQrLoginUrl = (baseUrl: string, token: string): string =>
  `${normalizeBaseUrl(baseUrl)}/qr-login?token=${encodeURIComponent(token)}`;
```

渲染：`WebuiControlPanel.tsx:492` → `<QRCodeSVGLazy value={qrUrl} size={140} level='M' />`（`qrcode.react` 的 `QRCodeSVG`）。

所以二维码里**只有一个明文字符串**，形如：

```
http://192.168.1.42:25808/qr-login?token=3f9a...（64 位小写 hex）
```

**没有** JSON、没有自定义 scheme、没有版本号、没有设备名、没有指纹。

`baseUrl` 的挑选（`getWebuiQrBaseUrls`）：
- 优先用 `accessUrls` + `status.networkUrls` + `status.networkUrl` 里**可远程到达**的地址；
  过滤掉 `localhost`、`0.x`、`127.x`、`169.254.x`（link-local）、`198.18/19`、TEST-NET 段、`>=224`（多播）。
- 多网卡 / VPN 主机会给出多个候选，面板上有个下拉让用户自己选（`WebuiControlPanel.tsx:457`）。
- 若 `allowRemote` 为假或一个可用远程地址都没有 → 回落到 `status.localUrl`，最后回落
  `http://localhost:<fallbackPort>`（此时手机扫了也连不上）。

### 5.2 token 的性质

`crates/backend/nomifun-auth/src/qr_token.rs`

- 32 字节 OS 随机 → **64 字符 hex**。
- 存在进程内 `DashMap`，**TTL 5 分钟**（`QR_TOKEN_TTL_MS`），**一次性消费**
  （`validate_and_consume` 原子检查 存在 / 过期 / 已用）。
- 桌面 UI 每 **4 分钟**自动刷新一次（`WebuiControlPanel.tsx:208`），避免面板一直开着就失效。
- 铸造端点 `POST /api/webui/generate-qr-token` 是 **local-trust 独占**
  （`crates/backend/nomifun-auth/src/routes.rs:106` + `require_local_trust_middleware`），
  返回 `{ success, data: { token, expires_at_ms } }`。
  → **远程客户端拿不到这个端点**，二维码只能由桌面自己生成并显示。

### 5.3 一个坑：token 只能被消费一次

如果手机的系统相机 / 微信扫码先把这条 URL 在浏览器里打开了，那个页面会立刻
`POST /api/auth/qr-login` 把 token 吃掉；随后 App 再拿同一个 token 去换 JWT 会拿到
`401 Invalid QR token`。

→ **mobile 必须用 App 内置的扫码器**，不要走系统「扫码打开链接」。

---

## 6. 远程客户端的认证流程

### 6.1 二维码登录（推荐给 mobile）

`POST /api/auth/qr-login`（`crates/backend/nomifun-auth/src/routes.rs:534`）

```http
POST http://<ip>:<port>/api/auth/qr-login
Content-Type: application/json

{"qr_token":"<二维码 URL 里的 token 参数>"}
```

- 请求体字段名是 **snake_case `qr_token`**，且 `#[serde(deny_unknown_fields)]` ——
  写成 `qrToken` 会被拒（`crates/backend/nomifun-api-types/tests/auth_types.rs` 有断言）。
- **CSRF 豁免**（`crates/backend/nomifun-auth/src/csrf.rs:45` 的 exempt 列表）。
- 成功返回 `200`：

```json
{ "success": true, "message": "Login successful",
  "user": { "user_id": "...", "username": "admin" },
  "token": "<JWT>" }
```

  同时带 `Set-Cookie: nomifun-session=<JWT>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`。
- **原生 App 只需要 body 里的 `token`**，后续用 `Authorization: Bearer <token>`。
  cookie 可以完全无视（`reject_plaintext_login_when_secure` 对无 `Origin` 的非浏览器客户端不生效）。
- 无论库里有多少用户，二维码登录**总是登入 primary WebUI admin**
  （`get_primary_webui_user()`），它是「跳过密码表单」的捷径，不是多用户特性。

浏览器路径（供参考，mobile 不必走）：`GET /qr-login` 返回一页内嵌 HTML
（`routes.rs:575` 的 `QR_LOGIN_HTML` 常量），JS 自己 POST 上面那个端点，成功后
写 `sessionStorage['nomifun:qr-login-resume']`，探测 `/?nomifun_spa_shell_check=1` 通了再
`location.replace('/#/guid')`。

### 6.2 密码登录（手输地址时的兜底）

`POST /login`，body `{"username","password"}`（`deny_unknown_fields`），返回结构与上面完全一致。
用户名规则 3–32 字符 `[a-zA-Z0-9_-]` 且不以 `-`/`_` 开头结尾；密码 8–128 且不在常见密码黑名单里。
密码由第 4 节第 3 步生成，只在面板上明文显示一次，之后遮蔽为 `******`（后端只存 bcrypt）。

### 6.3 首次运行 / 未初始化

`GET /api/auth/status`（公开，无需认证）：

```json
{ "success": true, "needs_setup": false, "user_count": 1, "is_authenticated": false }
```

`needs_setup: true` 时可以 `POST /api/auth/setup` `{username,password}` 认领 admin（也 CSRF 豁免，
返回同样的 `{success,user,token}`）。
但桌面路径下 `start_lan()` 已经预置了密码，所以**手机看到的桌面实例几乎永远是 `needs_setup: false`**。
这个端点仍是探测「地址对不对 / 是不是 nomifun」的最佳无认证探针（另有 `GET /health` 做存活探针）。

### 6.4 后续请求的鉴权

`crates/backend/nomifun-auth/src/middleware.rs:81 auth_middleware`

- token 提取顺序：`Authorization: Bearer` → `Cookie: nomifun-session`（`extract.rs`）。
- **Bearer 完全可用**，这是 mobile 的路子。
- 验签 → 查库确认用户还在 → 注入 `CurrentUser`。
- 失败统一返回 **403**（不是 401），body `{"code":"FORBIDDEN","error":"Invalid or expired token"|"Authentication required"|"User not found"}`。
  前端据此判定 session 过期（`ui/src/common/adapter/httpBridge.ts` 的 `isAuthExpiredResponse`）。
- 滑动续期只对 cookie 会话生效；Bearer 客户端要自己调 `POST /api/auth/refresh`。

### 6.5 ⚠️ CSRF 会拦住原生 App 的写请求

`crates/backend/nomifun-app/src/router/routes.rs:1126` 起：只要 `auth_policy != NoAuth`（桌面是
`TrustLocalToken`，所以**成立**），整个 `/api` router 外面就会套一层
`csrf_middleware`（`crates/backend/nomifun-auth/src/csrf.rs:36`）。规则：

- `GET/HEAD/OPTIONS` 直接放行。
- 豁免路径只有 4 条：`/login`、`/api/auth/qr-login`、`/api/auth/setup`、`/logout`。
- 带 local-trust 头的请求跳过（桌面 webview）。
- **其它所有 POST/PUT/PATCH/DELETE**：必须 `x-csrf-token` 头 == `nomifun-csrf-token` cookie，
  否则 **403 `CSRF token validation failed`**。
- 它**不认 Bearer**：拿着合法 JWT 的原生客户端一样会被拦。
- 每个响应都会重发 `Set-Cookie: nomifun-csrf-token=<同值或新值>; Max-Age=30d`（滑动续期），
  且**服务端会原样反射客户端已有的 cookie 值**。

→ **mobile 必须实现的最小方案**：自己生成一个 64 位 hex 随机串 `X`，此后每个请求都带

```
Cookie: nomifun-csrf-token=X
x-csrf-token: X       # 仅写请求需要，带上也无害
```

双提交自然匹配，不需要先 GET 一次去取 cookie。
（`/api/auth/refresh` **不在**豁免列表里，刷新 token 也要带这对值。）

### 6.6 常量表（都在 `crates/backend/nomifun-common/src/constants.rs`）

| 名字 | 值 |
|---|---|
| session cookie | `nomifun-session`（HttpOnly, SameSite=Lax, 30 天；`NOMIFUN_HTTPS=true` 时 Secure + Strict） |
| CSRF cookie | `nomifun-csrf-token`（**非** HttpOnly） |
| CSRF 头 | `x-csrf-token` |
| local-trust 头 | `x-nomi-local-trust`（`crates/backend/nomifun-auth/src/trust.rs:32`，仅桌面 webview） |
| JWT / session 有效期 | 30 天（`COOKIE_MAX_AGE_DAYS = 30`；JWT `TOKEN_EXPIRY` 同值） |
| body 上限 | 10MB（`BODY_LIMIT`，`/api/fs/upload` 另有更大配额） |

### 6.7 token 生命周期与失效条件

- JWT 30 天。`POST /api/auth/refresh` body `{"token":"<旧>"}` → `{"success":true,"token":"<新>"}`，
  不需要 auth 中间件，但**需要 CSRF 对**（见 6.5）。
- JWT 签名密钥**持久化在库里**（`services.rs:2232` 从 installation owner 的 `jwt_secret` 读，
  空则生成并写回）→ **桌面重启不会让手机的 token 失效**。
- 会让 token 立刻失效的操作：
  - 桌面/远程改密码（`/api/auth/change-password` 会 `rotate_secret()` 并写库 → 所有会话全灭）；
  - 「重置密码」（后端生成 16 位新随机密码，一次性显示）；
  - `POST /logout`（把该 token 加入黑名单）。
  - 注意：local-trust 的 `/api/webui/change-password`（桌面面板走的那条）**不**轮换密钥。

### 6.8 限流

`crates/backend/nomifun-auth/src/rate_limit.rs`，**只作用于 auth 路由组**，其它业务 API 不限流。

| 限流器 | 配额 | 覆盖 | key |
|---|---|---|---|
| auth | **5 次 / 15 分钟** | `/login`、`/api/auth/setup`、`/api/auth/qr-login` | 客户端 IP |
| api | 60 次 / 分钟 | `/api/auth/status`、`/api/webui/*`、`/api/auth/*` | 客户端 IP |
| authenticated action | 20 次 / 分钟 | `/logout`、`/api/auth/user`、`/api/auth/change-*`、`/api/ws-token`、`/api/auth/refresh` | token 哈希 → user id → IP |

auth 限流**只在响应 401/403 时计数**（`rate_limit.rs:202`），400/409/429/5xx 不消耗配额。
但仍要小心：手机反复扫过期二维码 → 反复 401 → **5 次之后 15 分钟内连密码登录都进不去**。
mobile 应在本地就判断 token 是否超 5 分钟、并对 401 做退避提示而不是自动重试。

---

## 7. WebSocket（实时流式回复）

- 路由 `GET /ws`（`crates/backend/nomifun-app/src/router/routes.rs:1003`），
  处理器 `crates/backend/nomifun-realtime/src/handler.rs:62`。
- 它挂在 **CSRF 层之外**（router 组装时 `ws_routes` 在 csrf layer 之后 merge），所以 WS 不受 CSRF 影响。
- Origin 判定（`handler.rs:153 validate_origin`）：
  - **没有 `Origin` 头 → `NonBrowser`**，走正常 token 提取；
  - 有 Origin 且与 `Host` / 首个 `X-Forwarded-Host` / `NOMIFUN_ALLOWED_ORIGINS` 匹配 → `SameOrigin`；
  - 已知的 Tauri / loopback 开发 origin → `LocalWebview`，**必须**用 subprotocol 显式带凭据；
  - 其它一切（畸形、重复、不认识的域）→ 403 fail-closed。
- token 提取顺序（`crates/backend/nomifun-auth/src/extract.rs:48`）：
  `Authorization: Bearer` → `Cookie: nomifun-session` → **`Sec-WebSocket-Protocol` 的第一个值**。
- 服务端会把选中的 subprotocol 回显，握手才能成立。

→ **mobile 两条可行路子**：
1. RN 的 `WebSocket(url, undefined, { headers: { Authorization: 'Bearer …' } })`（Android/iOS 原生实现支持自定义头）；
2. 更稳的：`new WebSocket(url, [jwt])` —— 把 JWT 当 subprotocol 传（桌面 webview 用的就是这招，
   因为浏览器 WS 不能设自定义头）。服务端会 verify 并回显。
- 另有 `GET /api/ws-token`（需已认证）返回 `{success, ws_token, expires_in}`，
  但它只是**把当前 token 原样回吐**（`routes.rs:509` 起），并没有单独铸造短期 WS 票据 ——
  mobile 直接复用登录拿到的 JWT 即可，不必调它（还会吃 20/min 的配额）。

---

## 8. 发现机制：没有

grep 全仓库：**无 mDNS / Bonjour / zeroconf / SSDP / UDP 广播**。相关的只有两处，都不是发现：

1. `crates/backend/nomifun-app/src/lan_endpoint.rs:238 detect_all_lan_ipv4s()` ——
   枚举本机非 loopback IPv4（`if_addrs`），配合 `routing_primary_ipv4()`（`lan_endpoint.rs:199`
   开一个 UDP socket 连外部地址来问内核「默认出口是哪张网卡」，**不发包**）。
   纯粹用来拼「访问地址」字符串给人看/给二维码用。
2. 机器人（ESP32）端点广告：设备通过 `/robot/ota` 的响应**被告知**一条裸
   `ws://<ipv4>:<port>` URL（`GET /api/robots/endpoints` 可查，需 owner 认证；
   Docker 下必须用 `NOMIFUN_ROBOT_ADVERTISE` 手动指定）。这是「服务端告诉设备去哪」，
   设备仍需先知道 OTA 地址 —— 同样不是自动发现。

→ mobile phase-1 的连接入口只能是：**扫码** 或 **手输 `IP:PORT`**（+ 历史记录）。

---

## 9. mobile phase-1 缺什么（按优先级）

### P0 — 会直接卡住流程

1. **桌面重启后 LAN 服务不自动恢复。**
   `webui.desktop.enabled` 只写不读（第 4 节）。用户每次开机都得手动去 `/open-capabilities`
   点开关，手机才能连。
   → 要么在 nomifun-tauri 侧补一个「启动时读该键并自动 `start_lan()`」（改动很小），
   要么 mobile 必须把「请到桌面上打开 WebUI 远程访问」写进连接失败的引导文案里。

2. **二维码 token 5 分钟 TTL + 一次性消费，且只能由桌面铸造。**
   手机端没有任何「配对码」概念，token 一旦被系统浏览器抢先消费就废了。
   → 必须自建扫码器；扫到后**立刻**换 JWT；失败时明确提示「请点刷新二维码重扫」。

3. **CSRF 双提交会 403 掉所有写请求**（第 6.5 节）。
   → HTTP 客户端拦截器里统一注入自造的 `nomifun-csrf-token` cookie + `x-csrf-token` 头。
   这是最容易在联调时浪费半天的坑。

### P1 — 体验/健壮性

4. **二维码里没有任何元数据。** 只有 `http://ip:port/qr-login?token=…`。
   没有实例名、没有桌面主机名、没有协议版本、没有备用地址列表。
   → mobile 拿到后要自己 `GET /api/auth/status`（或 `/health`）确认可达，
     再用 `GET /api/auth/user` 拿 `username` 作为连接卡片的标题。
   → 多网卡场景下二维码只带**用户在下拉里选中的那一个**地址；选错了手机就是连不上，
     且 App 无法自动尝试其它候选（它看不到 `networkUrls`）。可考虑连上后立刻缓存一份
     可达地址（但 `/api/webui/*` 是 local-trust 独占，远程读不到 status，见下）。

5. **远程客户端读不到 WebUI 状态。**
   `webui.getStatus/start/stop` 是 **Tauri IPC 命令**（`apps/desktop/src/main.rs:895-909`），
   不是 HTTP 端点；`/api/webui/*` 那几个 HTTP 端点全部 `require_local_trust`。
   → 手机**无法**查询/切换 LAN 服务，也拿不到 `networkUrls`、`adminUsername`、`port`。
     连接界面上「服务器信息」只能靠 `/api/auth/user` + 手机自己记的地址。

6. **HTTP 明文，无 TLS。** 桌面 LAN 监听器没有内建 TLS（文档明确说「仅可信局域网」）。
   → Android 需要 `usesCleartextTraffic` / network-security-config 放行明文；
     iOS 需要 ATS 例外（`NSAllowsLocalNetworking` 对局域网 IP 够用）。
   → iOS 14+ 还需要 `NSLocalNetworkUsageDescription`（本地网络权限弹窗），
     否则连局域网 IP 会静默失败。**这是 iOS 上最容易漏的一项。**

7. **auth 限流 5 次 / 15 分钟**（第 6.8 节）。扫码失败重试要有退避，别把用户锁死。

### P2 — 长期

8. **没有设备级凭据/配对模型。** 二维码登录永远登入 primary admin，手机拿到的就是
   「等价于桌面本地用户」的全权 token（shell / 文件 / agent 执行）。
   没有「这台手机」的独立身份、没有按设备吊销、没有已登录设备列表。
   唯一的吊销手段是改密码（会把所有会话一起干掉）。
   → 若将来要做「管理已连接手机」，服务端需要新表 + 新端点，现在完全没有。

9. **`Companion access token` 不适合 mobile。**
   `POST /api/webui/companions/{id}/access-token`（`require_local_trust`，桌面独占）铸造的
   64 位 hex 令牌走的是 `/mcp`、`/mcp-agent`、`/v1/tools/*` 这套**外部伙伴能力面**
   （Remote surface：敏感能力被拒、破坏性操作要二次确认），
   **不是** WebUI 的 `/api/*` 业务面。mobile 要复刻 WebUI 的六大功能页，应该用 JWT 走 `/api/*`，
   不要走伙伴令牌。

10. **无远程唤醒 / 无中继。** 只能同一局域网（或 VPN / Tailscale）。跨网访问要用户自己
    去部署 `nomifun-web`（默认 8787）或做端口转发 —— 那是另一套部署形态，
    但**协议完全一致**，所以 mobile 只要允许手输任意 `host:port`（含域名 + https），
    就能顺带支持连自建服务器。注意反代场景下 `/ws` 握手要求保留原始 `Host`
    （否则 403，症状是「一直显示执行中，刷新才更新」）。

---

## 10. mobile 侧建议的最小连接实现

```
1. 扫码（App 内置扫码器）
   → 得到 raw = "http://192.168.1.42:25808/qr-login?token=<hex64>"
   → 解析：baseUrl = origin（"http://192.168.1.42:25808"），token = query.token
   → 如果解析不出 token / 不是 /qr-login 路径 → 提示二维码不对

2. 探活（可选但推荐，能给出更好的错误文案）
   GET {baseUrl}/api/auth/status        // 无需认证
   → 超时/连不上：提示「手机和电脑是否同一 Wi-Fi？桌面是否已打开 WebUI 远程访问？」

3. 换 JWT（要快，5 分钟 TTL）
   POST {baseUrl}/api/auth/qr-login
   Content-Type: application/json
   Cookie: nomifun-csrf-token=<自造 hex64>          // 这条其实豁免 CSRF，带着无害
   {"qr_token":"<token>"}
   → 200 → 存 { baseUrl, jwt: body.token, userId: body.user.user_id, username: body.user.username }
   → 401 → token 过期或已被消费，提示重新扫

4. 之后所有 HTTP 请求
   Authorization: Bearer <jwt>
   Cookie: nomifun-csrf-token=<同一个 X>
   x-csrf-token: <同一个 X>                          // 写请求必须
   不要发 Origin 头（避免撞 host_guard / WS origin 判定）
   403 + code=FORBIDDEN + error 含 "Invalid or expired token" → 判定为掉线，回连接页

5. WebSocket
   new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws`, [jwt])   // JWT 当 subprotocol
   （或 RN 原生自定义头 Authorization: Bearer）

6. 手输地址兜底
   用户填 host + port（默认预填 25808）→ GET /api/auth/status 探活
   → needs_setup=true？走 POST /api/auth/setup 创建 admin
   → 否则 POST /login {username,password}（用户名默认 admin，密码从桌面面板抄）
```

---

## 11. 相关源码索引

| 主题 | 路径 |
|---|---|
| 桌面双监听器 / `start_lan` / host guard | `crates/backend/nomifun-app/src/desktop.rs`（`WEBUI_LAN_PORT:50`、`WebUiStatus:250`、`start_lan:1115`、`bind_lan:1647`、`host_guard_middleware:1710`） |
| 端口回落 + `port.json` 公告 | `crates/backend/nomifun-app/src/bootstrap/bind.rs` |
| 网卡探测 / 机器人端点广告 | `crates/backend/nomifun-app/src/lan_endpoint.rs` |
| router 组装、CSRF 层位置、`/ws` 挂载 | `crates/backend/nomifun-app/src/router/routes.rs`（`/ws`:1003、csrf layer:1126） |
| WS token 提取器 | `crates/backend/nomifun-app/src/router/state.rs:2188 build_ws_state` |
| 全部 auth / qr 端点 + 内嵌 `/qr-login` HTML | `crates/backend/nomifun-auth/src/routes.rs` |
| QR token store（TTL / 一次性） | `crates/backend/nomifun-auth/src/qr_token.rs` |
| CSRF 双提交中间件 + 豁免列表 | `crates/backend/nomifun-auth/src/csrf.rs` |
| auth 中间件 / Bearer 提取 | `crates/backend/nomifun-auth/src/middleware.rs`、`extract.rs` |
| cookie 属性 / HTTPS 陷阱 | `crates/backend/nomifun-auth/src/cookie.rs` |
| 限流配额 | `crates/backend/nomifun-auth/src/rate_limit.rs` |
| WS origin 判定 | `crates/backend/nomifun-realtime/src/handler.rs` |
| 请求/响应 DTO（snake_case 契约） | `crates/backend/nomifun-api-types/src/auth.rs` |
| Tauri `webui_*` 命令 | `apps/desktop/src/main.rs:895-909`、注册于 `:2880` |
| 二维码 UI + 地址选择器 | `ui/src/renderer/components/layout/Sider/WebuiControlPanel.tsx` |
| 二维码 URL 构造 + 地址过滤 | `ui/src/renderer/components/layout/Sider/webuiQrLinks.ts` |
| LAN 服务状态/开关的单一来源 | `ui/src/renderer/hooks/context/WebuiServerContext.tsx` |
| 前端 HTTP/WS 客户端（CSRF、local-trust、认证过期处理） | `ui/src/common/adapter/httpBridge.ts` |
| webui IPC/HTTP 桥定义 | `ui/src/common/adapter/ipcBridge.ts:2445-2560` |
| LAN 端到端行为断言（最好的活文档） | `crates/backend/nomifun-app/tests/webui_lan_smoke.rs` |
| CSRF 豁免 / cookie 属性断言 | `crates/backend/nomifun-app/tests/auth_e2e.rs` |
| 官方文档 | `docs/guides/webui-remote-access.zh.md`、`web-server-deployment.zh.md`、`remote-capability-api.zh.md`、`remote-capability-api-examples.zh.md` |
