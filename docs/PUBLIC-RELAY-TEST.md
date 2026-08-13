# Nomifun 跨公网联通与三项目自测手册

> 适用版本：当前工作区的 `nomifun-mobile`、`nomifun-desktop`、
> `nomifun-net-infra`。<br>
> 文档日期：2026-08-13。

本文只描述已经接通的实际链路和可重复的测试步骤，不把业务逻辑搬到
Relay 或 Mobile。Mobile 仍然是 Desktop WebUI 的薄客户端。

## 0. 先看结论

截至 2026 年 8 月 13 日，以下链路已经在本机环境验证成功：

```text
Windows Mobile/H5
        │ HTTP /api/* + WebSocket /ws
        ▼
Relay 业务入口 TCP
        │ QUIC/UDP + SPKI pin
        ▼
Windows nfagent
        │
        ▼
Windows Desktop WebUI :25808
```

这证明三个项目的协议和配对实现已经打通，但**不等于公网验收已经完成**。
真正的公网验收还需要真实 VPS/公网 DNS、云安全组、UDP 放行、HTTPS/WSS
反向代理，以及一台不在同一台机器上的 4G/5G 客户端。

上一个会话长时间没有结果的主要原因是：

1. Desktop 曾连接旧 Relay，旧 Relay 没有已建立的 agent 会话；
2. `-advertise 127.0.0.1:...` 让 Windows agent 无法从外部连接；
3. 改为 Windows 可达的 WSL 地址后，链路才变成 `online/active`。

## 1. 三个地址和端口不要混淆

| 地址/端口 | 用途 | 谁使用 |
| --- | --- | --- |
| Relay QUIC 承载，例如 `8443/udp` | `nfagent` 连接 Relay 的控制/数据承载 | Desktop/nfagent；Mobile 不填 |
| Relay 控制台，例如 `9443/tcp` | Relay 管理员登录、创建 invite、查看 agent/tunnel | 运维人员；Mobile 不填 |
| Desktop 业务入口，例如 `19090/tcp` | Relay 转发到 Desktop `127.0.0.1:25808` | Mobile/H5 使用 |
| HTTPS/WSS，例如 `443/tcp` | 生产反向代理或 Relay shared gateway | 浏览器/H5/Native |
| L2 回退，例如 `443/tcp` | 通用 nfagent 的 TCP/TLS 回退 | 仅通用手工 agent 流程 |

**当前 Desktop UI 配对流程固定使用 `-l2-port 0`。**
因此这个流程不会自动从 QUIC/UDP 回退到 TCP/443。公网部署必须优先保证
Relay 的 QUIC UDP 端口可达；不要把通用 `nfagent` 文档中的 L2 自动回退
误认为 Desktop 配对已经启用。

## 2. 前置准备

### 2.1 仓库位置

PowerShell：

```powershell
$MobileRepo  = 'C:\Users\rika0\code\nomifun\bak\mobile\nomifun-mobile'
$DesktopRepo = 'C:\Users\rika0\code\nomifun\nomifun-desktop'
```

WSL Ubuntu：

```bash
cd /home/rika/code/nomifun-net-infra
```

### 2.2 构建 Relay 和 Windows nfagent

如果 `nomifun-net-infra/bin/` 中已有对应二进制，可以跳过构建。

```bash
cd /home/rika/code/nomifun-net-infra
make build
```

`make build` 默认生成 Linux 二进制。Desktop 在 Windows 上运行时必须使用
Windows 版本的 `nfagent.exe`；如果它不存在，在 WSL 中执行：

```bash
cd /home/rika/code/nomifun-net-infra
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
  go build -trimpath -o bin/nfagent.exe ./cmd/nfagent
```

不要把 Linux 的 `bin/nfagent` 配给 Windows Desktop。

### 2.3 可选：给 Desktop 使用隔离测试数据目录

如果不想碰现有 Desktop 数据，可以在启动 Desktop 前设置一个专用目录：

```powershell
$env:NOMIFUN_DATA_DIR = 'C:\Users\rika0\code\nomifun\nomifun-desktop\.tmp-public-relay-test'
```

只有在你明确想做一次全新测试时才设置它。不要把生产 Desktop 指到临时目录。

## 3. 本机 WSL + Windows 联调（推荐先跑这一条）

这一节先不涉及公网 DNS，目标是快速证明三项目功能链路。

### 3.1 启动 Relay

先在 WSL 中取得当前 WSL2 地址。WSL 重启后该地址可能变化：

```bash
cd /home/rika/code/nomifun-net-infra
WSL_IP="$(hostname -I | awk '{print $1}')"
echo "$WSL_IP"
```

下面这组命令可以直接在**同一个 WSL 终端**执行：

```bash
QUIC_PORT=18463
CONSOLE_PORT=19463
BUSINESS_PORT=25808

./bin/nfrelay \
  -data-dir /tmp/nomifun-relay-test \
  -bind "0.0.0.0:${QUIC_PORT}" \
  -advertise "${WSL_IP}:${QUIC_PORT}" \
  -console "127.0.0.1:${CONSOLE_PORT}" \
  -desktop-business-url "http://${WSL_IP}:${BUSINESS_PORT}" \
  -log-level info
```

如果要在 PowerShell 中复用同一个地址，可以手工复制 `echo "$WSL_IP"` 的输出，
或者执行：

```powershell
$WSL_IP = ((wsl.exe -d Ubuntu -- hostname -I) -split '\s+')[0]
```

说明：

- `-advertise` 是 Windows Desktop/nfagent 实际要连接的地址，不能写
  `127.0.0.1`；
- `-desktop-business-url` 是最终交给 Mobile 的业务地址；
- `-data-dir` 会保存 Relay 数据库和证书。不要每次随意删除，否则 SPKI
  pin 会改变，已有 agent 需要重新配对；
- Desktop 本地 WebUI 端口固定是 `25808`；Relay 外部 `listen_port` 可以是
  其他空闲端口（例如 `19090`）。如果设置了
  `-desktop-business-url`，它只是最终交给 Mobile 的稳定 origin，端口可以是
  `443` 或其他反向代理端口；Desktop 真正校验的是 Relay 返回的
  `probe_url` 端口必须等于 invite 的 `listen_port`。

Windows 浏览器打开 Relay 控制台：

```text
http://127.0.0.1:19463
```

如果 Windows 无法通过 `127.0.0.1` 访问 WSL 控制台，先确认 WSL 进程仍在运行；
生产环境不要把控制台绑定到公网，使用 SSH 隧道访问。

### 3.2 Relay 首次初始化

第一次打开控制台时，立即完成管理员初始化：

1. 创建管理员用户名和密码；
2. 密码至少 12 个字符；
3. 保存到密码管理器；
4. 不要把管理员密码写入 Mobile、QR、配对串或仓库文档。

控制台是 Relay 管理面，不是 Mobile 的连接地址。

### 3.3 在 Relay 控制台创建 Desktop 配对邀请

在 Relay 控制台进入：

```text
代理端 → Desktop 配对 → 创建
```

填写或确认：

- `listen_port`：`25808`；
- TTL：本地测试可用默认值（通常为 10 分钟）；
- 备注：可填 `local-desktop-test`。

复制完整的：

```text
nomifun-relay-pair:v1:<base64url-payload>
```

这是一条**给 Desktop 使用的 Relay bootstrap invite**，不是 Mobile QR。
它是一次性凭据，过期或被消费后不能重复使用。

### 3.4 启动 Windows Desktop，并指定 Windows nfagent

在 PowerShell 中：

```powershell
cd $DesktopRepo

# WSL 中构建出的 Windows agent，通过 \\wsl.localhost 暴露给 Windows。
$env:NOMIFUN_NFAGENT_PATH = '\\wsl.localhost\Ubuntu\home\rika\code\nomifun-net-infra\bin\nfagent.exe'

# 如果上一节启用了隔离数据目录，在这里保持同一个环境变量。
# $env:NOMIFUN_DATA_DIR = 'C:\Users\rika0\code\nomifun\nomifun-desktop\.tmp-public-relay-test'

bun run dev
```

如果使用已打包的 Desktop，则不需要设置 `NOMIFUN_NFAGENT_PATH`，前提是
安装包已经包含对应平台的 `nfagent.exe`。

### 3.5 在 Desktop 粘贴 Relay 配对串

Desktop 中进入：

```text
开放能力 → WebUI 远程访问 → Relay 配对
```

将 3.3 复制的 `nomifun-relay-pair:v1:...` 粘贴进去，点击“连接 Relay”。

Desktop 会自动完成以下工作：

1. 向 Relay 的 `/api/bootstrap/desktop` 兑换一次性 invite；
2. 创建固定后端 `127.0.0.1:25808` 的 Desktop 隧道；
3. 启动 Windows `nfagent`，当前参数包含 `-l2-port 0`；
4. 等待 agent 凭据落盘并通过 `probe_url` 访问
   `/api/auth/status`；
5. 生成最终的 Desktop Mobile 配对地址。

探测阶段预算为 **45 秒**；由于单次 HTTP 请求本身有超时，实际操作给它
**45–60 秒**。成功状态应为：

```text
已连接 / connected
```

成功后，Desktop 面板会显示新的二维码和一条类似下面的地址：

```text
nomi://pair?v=1&url=<percent-encoded-http(s)-qr-login-url>
```

**推荐扫描这一个最终 `nomi://pair` 二维码。** Mobile 仍兼容旧版 Desktop
直接显示的 `http(s)://.../qr-login?token=...` 二维码；两者都不是 Relay
控制台的管理串。不要扫描或粘贴 Relay bootstrap invite。

## 4. Mobile Native 自测

### 4.1 启动 Mobile

```powershell
cd $MobileRepo
bun install
bun run android
```

iOS 需要在 macOS 上运行 `bun run ios`；也可以使用 Expo Go 加载开发项目。

### 4.2 扫描最终 Desktop QR

在 Mobile 的连接页面点击“扫码连接”，扫描 3.5 中 Desktop 面板显示的最终
`nomi://pair?...` QR。

也可以点击“粘贴连接链接”，粘贴完整的 `nomi://pair?...` 地址。

Native Mobile 的行为是：

1. 解析配对包；
2. 从嵌套 URL 取出一次性 `/qr-login` token；
3. 向 Desktop **业务入口**调用 `POST /api/auth/qr-login`；
4. 不保存原始 pairing URL、Relay 管理员密码、enrol token 或 SPKI pin；
   本地会保存后续会话所需的 Desktop JWT、业务地址、用户和 CSRF 元数据；
5. 后续 HTTP 使用 Bearer JWT，WebSocket 使用 JWT subprotocol。

Relay 管理员密码、Relay enrol token、SPKI pin 和 QUIC 配置不会进入 Mobile。

### 4.3 Native 手动地址

不使用 QR 时，手动地址必须填**业务入口**，例如：

```text
http://<WSL_IP>:25808
https://desktop.example.com
```

不要填：

```text
http://127.0.0.1:19463   # Relay 控制台
<WSL_IP>:18463            # Relay QUIC 承载
```

如果只填主机名而不填端口，Mobile 会按 Desktop LAN 默认端口 `25808`
处理；Relay 场景建议始终填写完整的业务入口 URL。

## 5. H5 自测

H5 不能让浏览器直接跨源访问 Desktop/Relay。开发环境必须使用 Mobile 仓库
自带的同源代理。

在 Mobile 仓库的 PowerShell 中（沿用 3.1 设置好的 `$WSL_IP`）：

```powershell
cd $MobileRepo

$env:NOMIFUN_SERVER = "http://${WSL_IP}:25808"
bun run dev
```

`bun run dev` 会同时启动：

- Expo Web：`8081`；
- Mobile 同源开发代理：`8788`。

浏览器打开：

```text
http://127.0.0.1:8788
```

代理会将以下路径转发到 `NOMIFUN_SERVER`：

```text
/api/*
/login
/logout
/qr-login
/health
/ws
```

如果要让同一局域网的另一台设备访问 H5，使用运行 Mobile 代理的电脑的局域网
地址，例如 `http://<PC_LAN_IP>:8788`，而不是 WSL IP。

### H5 pairing URL 的限制

H5 始终把连接绑定保存为同源空地址，并将请求送到当前页面的同源代理。
因此，在 H5 中粘贴 `nomi://pair?...` **不会自动切换目标服务器**；必须先让
`NOMIFUN_SERVER`（开发环境）或生产反向代理指向该 pairing URL 内嵌的业务入口。
Native 扫码/粘贴则会直接使用嵌套的业务入口。

### H5 生产部署要求

生产 H5 必须满足：

```text
浏览器访问的 H5 页面、/api/*、/login、/logout、/qr-login、/health、/ws
使用同一个 origin
```

常见做法是让 Caddy/Nginx：

- 静态文件返回 H5；
- `/api`、`/login`、`/logout`、`/qr-login`、`/health`、`/ws` 反向代理到
  Desktop 业务入口；
- WebSocket 保留 HTTP/1.1 Upgrade。

不要把浏览器 H5 静态站点直接部署在一个域名，再把 API 指向另一个域名；
这会导致 Cookie、CSRF 或 WebSocket 跨源失败。

## 6. 最小验收清单

### 6.1 Relay liveness

Relay 控制台地址执行：

```powershell
curl.exe -i http://127.0.0.1:19463/healthz
```

预期：

```text
HTTP/1.1 200
{"ok":true}
```

这只证明 Relay HTTP 栈活着，不证明 agent 或 tunnel 已上线。

### 6.2 Relay 管理面状态

在已经登录 Relay 控制台的浏览器中检查：

```text
GET /api/agents
GET /api/tunnels
```

预期：

- `/api/agents` 中对应 Desktop agent：`online=true`；
- 承载梯级显示 `L0/QUIC`；
- `/api/tunnels` 中 Desktop tunnel：`active`；
- `state_reason` 为空或没有错误原因。

未登录直接请求这些管理 API 得到 `401` 是正常的。它们不是 Desktop
业务 API，也不是 Mobile API。

### 6.3 Desktop API 探活

从能访问业务入口的机器执行：

```powershell
$Business = "http://${WSL_IP}:25808"
curl.exe -i "$Business/api/auth/status"
```

预期 HTTP `200`，JSON 中应有：

```json
{
  "success": true,
  "needs_setup": false
}
```

这里的地址必须是业务入口，不是 Relay 控制台地址。

### 6.4 JWT 验证（可选）

每次 Desktop QR token 只能消费一次。只使用刚刚刷新、尚未扫描的 token，
不要把真实 token 或 JWT 写进脚本文件、日志或文档。

```powershell
# <fresh-qr-token> 只替换为刚刷新二维码中的一次性 token。
$login = curl.exe -s -X POST "$Business/api/auth/qr-login" `
  -H "Content-Type: application/json" `
  -d '{"qr_token":"<fresh-qr-token>"}' | ConvertFrom-Json

$jwt = $login.token
curl.exe -i -H "Authorization: Bearer $jwt" "$Business/api/auth/user"
curl.exe -i -H "Authorization: Bearer $jwt" "$Business/api/ws-token"

# 无效 JWT 应返回 HTTP 403。
curl.exe -i -H "Authorization: Bearer invalid" "$Business/api/auth/user"
```

预期：

- `/api/auth/user`：`200`；
- `/api/ws-token`：`200`，返回当前会话 JWT 的 WebSocket 复用值（仅用于诊断；
  Mobile 的实际 WebSocket 连接直接使用已保存 JWT）；
- 无效 JWT：`403`。

### 6.5 WebSocket ping/pong 验证（可选）

Desktop `/ws` 使用 JWT 作为 WebSocket subprotocol。下面脚本只在内存中使用
JWT，收到 `ping` 后原样回送 timestamp：

```powershell
$env:NOMI_WS_URL = (($Business -replace '^http', 'ws') + '/ws')
$env:NOMI_JWT = $jwt

@'
const ws = new WebSocket(process.env.NOMI_WS_URL, [process.env.NOMI_JWT]);
const deadline = setTimeout(() => {
  console.error("timeout: no ping received");
  ws.close();
  process.exit(1);
}, 20000);

ws.addEventListener("open", () => console.log("websocket open"));
ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.name === "ping") {
    ws.send(JSON.stringify({ name: "pong", data: message.data }));
    console.log("pong sent");
    clearTimeout(deadline);
    ws.close();
    process.exit(0);
  }
});
ws.addEventListener("error", () => {
  clearTimeout(deadline);
  console.error("websocket error");
  process.exit(1);
});
'@ | bun -
```

这段脚本验证的是**业务入口本身**的 WebSocket，不等同于 H5 Mobile 的同源代理
验收。H5 还应在浏览器开发者工具中确认 `ws://`/`wss://<当前页面 host>/ws`
握手为 `101`，并观察收到 `ping` 后有 `pong`。如果这里失败但 HTTP 正常，优先检查反向代理是否保留 WebSocket Upgrade，以及
是否把 JWT 放在 subprotocol 而不是普通 URL 参数。

## 7. 跨公网部署

### 7.1 最低网络要求

公网 Relay 主机至少需要：

| 方向 | 端口 | 说明 |
| --- | --- | --- |
| 入站 UDP | `8443`（或自定义 QUIC 端口） | Desktop/nfagent → Relay |
| 入站 TCP | Desktop tunnel `listen_port` | Mobile/HTTPS 代理 → Relay 业务入口 |
| 入站 TCP | `443` | HTTPS/WSS 反向代理；需要时也承载通用 agent L2 |
| 入站 TCP | `80` | 仅在使用 ACME HTTP-01 时需要 |
| 管理面 | `9443` | 只允许 loopback、VPN 或 SSH，不要公开 |

同时放行：

- 云厂商安全组；
- VPS 主机防火墙；
- Docker/systemd 端口映射（如果使用容器）。

`Test-NetConnection` 只能测试 TCP，不能证明 QUIC UDP 可达。UDP 必须结合
Relay `/api/agents` 的在线状态和 agent 日志/状态判断。

如果要启用通用 `nfagent` 的 L2/TCP 回退，Relay 还必须启动共享入口，例如
`-shared 0.0.0.0:443`，并放行 TCP/443；仅开放 443 而未启用 `-shared`，
L2 不会凭空出现。**当前 Desktop UI 自动配对固定传入 `-l2-port 0`，不使用
这条回退。**

### 7.2 Relay 启动示例

在公网 Relay 主机：

```bash
./bin/nfrelay \
  -data-dir /var/lib/nomirelay \
  -bind 0.0.0.0:8443 \
  -advertise relay.example.com:8443 \
  -console 127.0.0.1:9443 \
  -desktop-business-url https://desktop.example.com \
  -log-level info
```

注意：

- `relay.example.com:8443` 必须从 Desktop 主机出站可达；
- 必须持久化 `/var/lib/nomirelay`，否则 Relay 证书变化会造成 pin 不一致；
- `desktop.example.com` 只是最终交给 Mobile 的稳定业务 URL；它可以指向
  `443` 或其他 HTTPS 反向代理端口，不必等于 raw tunnel 的 `listen_port`；
- 如果需要通用 nfagent L2 回退，把 `-shared 0.0.0.0:443` 加到启动命令，
  并让 TCP/443 直达 Relay；普通 HTTP 反代不能随意占用/改写这个 ALPN 入口；
- `-desktop-business-url` **不会**创建 DNS、TLS 证书、Caddy/Nginx 路由，
  也不会改变实际 tunnel；
- Desktop bootstrap 期间仍会用 Relay 返回的 `probe_url`，形式为：
  `http://relay.example.com:<listen_port>/api/auth/status`。因此这个
  `listen_port` 从 Desktop 主机仍必须可达。

### 7.3 临时公网 HTTP 测试（仅 IP 直连）

为了先验证网络、不配置 TLS 时，可以让 Mobile Native 使用**公网 IP
字面量**访问 raw business port：

```text
http://<PUBLIC_IP>:<listen_port>
```

不要在这个 raw L4 测试中使用公网 DNS 名称：Desktop 的 LAN Host/Origin
保护只接受 IP literal 或 localhost，DNS 名称会得到 `403`。这只适合临时
测试；管理员密码、JWT 和业务数据会经过明文 HTTP，不要作为生产方案。

### 7.4 推荐生产 HTTPS：前置 Caddy

当前 Desktop 自动 bootstrap 创建的是：

```text
exposure=port
tls=passthrough
l4=tcp
backend=127.0.0.1:25808
```

这表示 Relay 做 TCP 转发，不表示它已经给 Desktop HTTP 加了 TLS。
因此不能把一个明文 raw tunnel 直接当成 `https://` 使用。

一种简单的生产结构是（Caddy 与 Relay 在同一台公网主机上）：

```text
Mobile/H5 -- HTTPS/WSS --> Caddy :443
                              │
                              ▼
                     Relay raw business port
                              │ QUIC
                              ▼
                     Desktop WebUI :25808
```

Caddy 示例（把 `<BUSINESS_PORT>` 换成 invite 实际分配的业务端口）：

```caddyfile
desktop.example.com {
    reverse_proxy 127.0.0.1:<BUSINESS_PORT> {
        # Desktop LAN listener 的 Host guard 接受本地地址。
        header_up Host 127.0.0.1:25808
        # H5/浏览器会发送 Origin；必要时也改成 Desktop 接受的本地 Origin。
        header_up Origin http://127.0.0.1:25808
    }
}
```

Caddy 会处理 WebSocket Upgrade。Nginx 等价配置必须显式使用 HTTP/1.1，并转发
`Upgrade`/`Connection` 头。

**不要关闭 raw business port。** Desktop 每次首次配对或恢复 agent 时都会
探测 Relay 返回的 `probe_url`；只开放 443、却封掉 `<BUSINESS_PORT>`，会表现为
Desktop 一直 `connecting` 或 45 秒超时。可以在防火墙中尽量限制该端口来源，
但必须保证 Desktop 主机能够访问。若 `probe_url` 端口不是公网直接暴露，
需要提供 Desktop 主机可达的端口映射或等价内网路径；仅配置 `443` 反代而
让 raw probe 端口完全不可达，仍会导致配对超时。

如果 Caddy 占用 `443/tcp`，不要同时让 Relay 使用
`-shared 0.0.0.0:443`；二者只能选择一个监听者。Caddy 方案不需要
`-shared`，而 L2/Shared Gateway 方案则需要 Relay 直接占用共享入口并按其
ALPN/路由规则配置，不能把普通 HTTP 反代随意套在该端口前面。

### 7.5 高级 shared gateway

Relay 也支持 `-shared`、TLS gateway、Host/SNI 路由和 ACME。那条路径需要在
Relay 控制台**手工创建 `exposure=shared` 隧道**，不要和 Desktop 的自动
`Desktop 配对`流程混写：

- 自动 Desktop bootstrap 创建的是独立 raw TCP 端口；
- `-shared` 不会自动把这条隧道改成 gateway；
- ACME 需要真实 DNS、证书挑战端口和正确的 `Host`/`Origin`/WebSocket 配置。

如果目标只是先让 Mobile 跨公网访问 Desktop，优先使用 7.4 的 HTTPS 反代方案。

## 8. 常见故障定位

### 8.1 Desktop 一直 `connecting`，45–60 秒后失败

按顺序检查：

1. **是否使用旧 invite？**<br>
   Relay invite 和 Desktop QR 都是一次性/短时凭据。回控制台重新创建
   `Desktop 配对`，不要重复粘贴旧串。
2. **`-advertise` 是否为 `127.0.0.1`？**<br>
   Windows Desktop 必须能访问该地址。WSL 用当前 `hostname -I` 地址；
   公网用真实 DNS/IP。
3. **Relay QUIC UDP 是否放行？**<br>
   同时检查云安全组、主机防火墙和 WSL/Windows 网络边界。
4. **是否换过 Relay `data-dir`？**<br>
   换目录会生成新的 Relay 证书，旧状态中的 pin 不再匹配。保留数据目录，
   或重新创建完整配对流程。
5. **业务端口是否可从 Desktop 主机访问？**<br>
   `probe_url` 是 raw HTTP 业务端口，不是 `-desktop-business-url` 的
   HTTPS 域名。先确保该端口可达。
6. **Windows nfagent 是否存在且为 `.exe`？**<br>
   源码开发时设置 `NOMIFUN_NFAGENT_PATH`。
7. **Desktop 的 `25808` 是否被占用？**<br>
   当前配对管理器要求 Desktop WebUI 正好监听 `25808`，不能接受静默回退到
   其他端口。

### 8.2 Mobile/H5 返回 404

- 把 Relay 控制台端口当成了 Mobile 地址；
- 业务端口填错，或 tunnel 已被删除/未 `active`；
- H5 代理没有转发 `/api` 或 `/ws`；
- 使用 `https://` 直连 raw HTTP tunnel，却没有 TLS 终止；
- 业务 URL 带了额外路径，当前 Desktop bootstrap 只接受 origin。

### 8.3 HTTP 返回 403

- 无效/过期 Desktop JWT：重新登录或刷新最终 Desktop QR；
- 把 Relay 管理 API 当成 Desktop API 调用；
- 前置代理把 `Host` 或 `Origin` 改成 Desktop 不接受的公网域名；
- 手工构造了错误的 CSRF 或 Bearer 头。

Relay 管理 API 的 `403` 还可能是管理员 session 的 CSRF/Origin 校验，不是
Mobile JWT 问题。

### 8.4 HTTP 正常但 WebSocket 失败

检查：

1. 代理是否保留 `Upgrade: websocket`；
2. 代理是否使用 HTTP/1.1 到上游；
3. 浏览器是否在同源环境访问 H5；
4. Native/脚本是否将 JWT 放入 WebSocket subprotocol；
5. `https` 是否对应 `wss`，而不是继续使用 `ws`。

### 8.5 `/api/agents` 显示 offline

`/api/agents` 是 Relay 控制台 API。确认：

- `online=true`；
- `rung=L0/QUIC`；
- Relay 的 `advertise` 主机和端口是 Desktop 可达地址；
- UDP 入站端口和 agent 出站网络都允许；
- 当前 Desktop 自动流程没有启用 L2 fallback；
- 没有同时运行连接旧 Relay 的旧 nfagent。

### 8.6 WSL 重启后突然不通

WSL2 虚拟网卡地址可能变化。重新执行：

```bash
hostname -I
```

然后更新 `-advertise` 和临时业务 URL，再创建新的 Desktop invite。
不要继续使用指向旧 WSL 地址的历史 pairing state。

## 9. 清理测试资源

建议按以下顺序清理，不要删除用户的生产数据：

1. 在 Desktop：
   ```text
   开放能力 → WebUI 远程访问 → Relay 配对 → 断开并清除配对
   ```
2. 在 Relay 控制台：
   - 删除本次创建的 `desktop-*` tunnel；
   - 撤销本次测试 agent（如果不再使用）。
3. 停止本次启动的 `nfrelay`（WSL 中按 `Ctrl+C`）。
4. 如果明确使用了专用临时目录，再删除该目录：
   - Relay 的专用 `data-dir`；
   - Desktop 的专用 `NOMIFUN_DATA_DIR`。

不要删除默认 Desktop 数据目录、Relay 生产数据目录或其他未明确由本次测试
创建的文件。一次性 invite/QR 过期后也不需要手工“复用”。

## 10. 安全边界（不要做）

- 不要把 Relay 管理员密码放进 Mobile；
- 不要把长期 `enrol token`、JWT 或 SPKI pin 写入源码/文档；
- 不要让 Mobile 调用 Relay 管理 API；
- 不要把 Relay 控制台直接暴露在公网明文 HTTP；
- 不要把 `-advertise` 写成 `127.0.0.1`，除非 agent 和 Relay 在同一网络命名空间；
- 不要把 `https://` 写进业务 URL，却没有真实 TLS 终止；
- 不要把“Relay QUIC 端口”填到 Mobile 的服务地址；
- 不要把 H5 的 API 部署成跨源绝对地址。

## 11. 一页式复测顺序

以后每次测试只按下面顺序走：

1. 启动 Relay，确认 `/healthz=200`；
2. 登录 Relay 控制台，确认管理员状态；
3. `代理端 → Desktop 配对 → 创建`；
4. Desktop `开放能力 → WebUI 远程访问 → Relay 配对` 粘贴 invite；
5. 等待最多 45–60 秒，确认 `connected`；
6. 确认 Relay `/api/agents` 为 `online`、`/api/tunnels` 为 `active`；
7. 扫描 Desktop **最终** `nomi://pair` QR；
8. Native 检查登录和页面刷新；
9. H5 设置 `NOMIFUN_SERVER`，访问 `:8788`，检查 HTTP 和 WS；
10. 最后再做外部 4G/5G 网络验收。
