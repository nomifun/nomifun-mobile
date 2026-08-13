# Mobile + NomiRelay 本地联调与接入说明

> 当前 Desktop 自动 Relay 配对（`代理端 → Desktop 配对 → 创建`）的完整
> WSL/Windows、公网端口和 Native/H5 验收步骤，请优先阅读
> [`PUBLIC-RELAY-TEST.md`](PUBLIC-RELAY-TEST.md)。本文保留较底层的通用
> agent/隧道 API 说明。

本文说明当前已经验证过的链路：

```text
nomifun-mobile H5
        │  HTTP /api/* + WebSocket /ws
        ▼
Relay 业务入口（隧道端口）
        │  nfagent QUIC（SPKI pin）
        ▼
Nomifun Desktop WebUI
```

手机端仍然是桌面端的薄客户端。Relay 只负责承载 HTTP/WebSocket 字节流，
不会把桌面端的业务逻辑搬到中继里。

## 1. 两个端口不要混淆

Relay 至少有两类端口：

| 端口 | 用途 | Mobile 是否使用 |
|---|---|---|
| 控制台端口（例如 `9443`） | Relay 管理员登录、创建 agent、创建隧道 | **不使用** |
| 业务入口端口（每条隧道独立，例如 `19090`） | 转发到 Desktop WebUI | **使用** |

Mobile 输入的是**业务入口地址**，例如：

```text
http://127.0.0.1:19090
https://relay.example.com:19090
```

把 Relay 控制台端口填进 Mobile 会得到 404、登录失败或不兼容的 API 响应。
Relay 管理员用户名和密码只应留在运维侧，绝不能写入 Mobile、二维码或客户端
配置文件。

## 2. 初始化流程（运维侧）

以下步骤需要在 Relay 所在机器或运维终端执行，Mobile 不参与管理员 API 调用。

### 2.1 启动 Relay 并初始化控制台

```bash
nfrelay -data-dir /var/lib/nomirelay \
  -bind 0.0.0.0:8443 \
  -console 127.0.0.1:9443
```

首次启动时记录：

- QUIC 承载地址；
- Relay 的 SPKI pin；
- 控制台管理员凭据。

生产环境应让控制台保持 loopback，或放在明确的 HTTPS 反向代理之后。
Relay 控制台默认是明文 HTTP，不应直接暴露到公网。

### 2.2 签发一次性 enrol token

在 Relay 控制台的 agent 页面签发 token，或者由运维脚本调用管理员 API。
token 是一次性的短时凭据，只用于首次把 `nfagent` 加入 Relay。

在**能够访问 Desktop 的机器**上启动 agent：

```bash
nfagent \
  -relay relay.example.com:8443 \
  -pin '<SPKI pin>' \
  -token '<enrol token>' \
  -state-dir /var/lib/nfagent
```

`-state-dir` 必须是持久目录。agent 首次入网后会保存长期凭据；重启时会使用
盘上的凭据自动重连，不应反复消费新的 enrol token。

Windows 示例：

```powershell
.\nfagent.exe `
  -relay 127.0.0.1:18443 `
  -pin '<SPKI pin>' `
  -token '<enrol token>' `
  -state-dir .\agent-state `
  -l2-port 0
```

这里的 `-l2-port 0` 仅用于关闭本地联调不需要的 TCP 回退；生产是否启用回退应
按 Relay 部署文档和网络策略决定。

### 2.3 创建 Desktop 业务隧道

agent 在线后，在 Relay 控制台创建一条端口隧道。典型配置如下：

```json
{
  "slug": "desktop",
  "kind": "service",
  "tls": "passthrough",
  "exposure": "port",
  "l4": "tcp",
  "listen_port": 19090,
  "backend": {
    "kind": "addr",
    "addr": "127.0.0.1:27878"
  }
}
```

创建完成后，确认隧道状态为 `active`，并记录 `listen_port`。这个端口才是
Mobile 的目标端口。

> 当前这种 `exposure=port` + `tls=passthrough` 配置是**裸 TCP 转发**。
> 如果 Desktop 监听的是明文 HTTP，那么 Mobile 到 Desktop 的业务流量也是明文。
> 它适合 loopback、可信内网或临时联调，不是公网生产方案。

## 3. Mobile 连接方式

### H5

H5 必须与 API 同源。开发时使用项目自带代理：

```powershell
$env:NOMIFUN_SERVER = 'http://127.0.0.1:19090'
bun run dev
```

浏览器访问：

```text
http://127.0.0.1:8788
```

H5 的绑定地址保存为相对地址 `""`，请求由代理转发到 Relay 业务入口。

### Native

Native 连接页接受以下形式：

```text
http://192.168.1.42:25808
https://relay.example.com:19090
relay.example.com:19090
192.168.1.42
```

裸主机名默认使用 Desktop LAN 端口 `25808`；Relay 场景应显式填写实际业务入口
端口。手动输入的 HTTPS、IPv6 和反向代理路径前缀会保留；自动 Relay pairing
URL 仍要求 origin 形状，不能依赖路径前缀。

Native 不保存原始 pairing URL、Relay 管理员凭据、enrol token 或 SPKI pin；
本地会保存 Desktop JWT、业务入口地址以及会话所需的用户/CSRF 元数据。
所有 `/api/*` 请求使用 Bearer JWT；写请求使用客户端生成的 CSRF 双提交值；
`/ws` 使用 JWT subprotocol。

## 4. 安全边界与生产注意事项

当前 Mobile 侧**没有**一键创建 Relay、签发 agent 或创建隧道的产品流程。
这是有意的安全边界：

- 不把 Relay admin password 放入 Mobile；
- 不让 Mobile 直接调用 Relay 管理员 API；
- 不把长期 enrol token 放进客户端；
- Mobile 只接收 Desktop JWT，或使用 Desktop 侧生成的一次性 QR token；
- 真正的一键化应由 operator-side bootstrap、部署脚本，或短时 invite/
  provision token 完成。

公网部署还需要单独验收：

1. Relay QUIC UDP 端口、防火墙和 agent 出站连接；
2. HTTPS/WSS gateway、证书和 ACME；
3. Desktop TLS 或端到端 TLS passthrough；
4. 反向代理的 `Host`、`Origin` 和 WebSocket Upgrade；
5. NAT、DNS 和多网卡地址选择；
6. Relay/agent 持久化、备份、重启与吊销策略。

**本地 loopback 联调通过，不等于以上公网条件已验收。**

## 5. 本地联调验收清单

下面的顺序覆盖完整业务链路，而不是只检查 Relay 控制台：

1. Desktop 监听 WebUI 端口；
2. Relay 启动并记录 SPKI pin；
3. agent 使用持久 `state-dir` 入网；
4. Relay 创建并显示 `active` 的 Desktop 业务隧道；
5. 通过业务入口执行：
   - `GET /api/auth/status`；
   - `POST /login`；
   - Bearer JWT 访问 `/api/auth/user`；
   - Bearer JWT 访问 `/api/ws-token`；
   - 无效 JWT 返回 `403`；
6. 使用有效 JWT 建立 `/ws`，收到 `ping` 后回送带原 timestamp 的 `pong`；
7. 用真实 Chromium 打开 H5，登录、刷新页面，确认 JWT 和 WebSocket 恢复；
8. 分别重启 agent、Relay、Desktop，确认持久凭据、隧道配置和客户端会话恢复；
9. 最后运行仓库离线门禁：

```powershell
bun run typecheck
bun test
bun run check:i18n
bun run export:web
git diff --check
```

完整浏览器 smoke：

```powershell
$env:NOMI_E2E_PLAYWRIGHT = 'C:\path\to\playwright-install'
$env:NOMI_E2E_EXECUTABLE_PATH = 'C:\path\to\chrome.exe'
$env:NOMI_E2E_BASE = 'http://127.0.0.1:8788'
$env:NOMI_E2E_USER = 'admin'
$env:NOMI_E2E_PASSWORD = '<Desktop password>'
$env:NOMI_E2E_SHOTS = '.tmp-e2e\screenshots\smoke'
bun run e2e
```

测试产生的数据库、二进制、凭据和截图应放在 `.tmp-e2e/` 等本地临时目录，
不要提交到 Git。
