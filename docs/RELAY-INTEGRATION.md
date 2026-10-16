# Mobile 与 NomiRelay 接入契约

Mobile 是 Desktop 的薄客户端。业务数据、AgentSession、Turn 和效果仍由
Desktop 维护。Relay 转发 HTTP / WebSocket 流量；手机不调用 Relay 管理 API，
不持有其管理员凭据、enrol token 或 agent 私钥。

```text
Mobile Native / 同源 H5
  → LAN 直连，或 Relay HTTPS / WSS 业务入口
  → nfagent（远程路径）
  → Desktop HTTP API / WebSocket
```

Relay 控制台地址用于部署和管理，不能填入 Mobile 的服务地址。
用户应使用 Desktop「连接与设备」提供的手机配对码及完整业务入口地址。
Relay 安装、证书、业务隧道和 agent 生命周期由 net-infra / Desktop 文档说明；
本页只定义 Mobile 消费边界。

## 配对与认证

1. `GET /api/connections/info` 不带现有凭据，读取 Desktop 身份、连接协议和能力。
2. 解析手机配对码：
   `nomifun://pair?v=1&url=<encoded https://entry/device-pair?token=...>`。
3. `POST /api/auth/device-pair` 兑换一次性票据，取得用户、设备身份及独立设备 JWT。
4. 认证读取 `GET /api/system/info`，确认 `storage_generation` 与
   `agent_data_generation` 后打开业务页面。

不使用扫码时，`POST /api/auth/device-login` 与
`POST /api/auth/device-setup` 接收账号、密码、设备名称、连接协议版本，
同样签发设备凭据。这些入口不建立浏览器管理会话；H5 调用省略 cookie。
旧 WebUI `/qr-login` 票据只属于浏览器登录，不能自动降级兑换为手机认证。

设备 JWT 用于 `Authorization: Bearer` 以及 `/ws` JWT subprotocol。
Bearer 写请求沿用 Desktop 现行 CSRF 豁免规则，不另造双提交 token。
`POST /api/auth/refresh` 保留同一设备身份；撤销后 refresh 也不能恢复它。
手机 `DELETE /api/connections/device` 只撤销本设备。全设备列表和管理仍由
Desktop 所有者入口提供，手机设备凭据不获得管理员权限。

Native JWT 保存在 Expo SecureStore；AsyncStorage 仅保存地址、设备与 Desktop
身份和数据世代。元数据只在安全凭据写入成功后提交指针，失败时保留旧绑定。
“仅清除本机连接”可以离线执行，不承诺已撤销服务器授权。

## Native 与 H5

Native 使用绝对服务地址。局域网可以使用
`http://192.168.1.42:25808`；远程入口必须是完整 HTTPS 地址。
省略 scheme 的地址按现行地址规范化规则进入 HTTP；公网地址随后会被拒绝，
不能把 `relay.example.com:19090` 当作等同于 HTTPS。

Native「连接与设备」可添加同一 Desktop 的直连或远程地址。
切换前先读取不带凭据的公开身份，再验证设备授权与数据世代。
身份不匹配不会向该地址发送已保存 JWT，也不会自动绑定另一台电脑。
配对目标仅支持 origin，不能假定二维码支持反向代理路径前缀。

H5 始终使用 `baseUrl: ''`。Mobile 页面、API 与 WebSocket 必须同源部署，
也可以由部署者配置同源代理。粘贴配对码时先校验码中的 origin 与当前站点
是否一致；跨站码在兑换前拒绝，不会悄悄发送到当前站点。
当前代码不自动部署 H5，也不把 Desktop 的桌面 WebUI 当作手机布局。

本机联调可使用已有开发代理，例如：

```powershell
$env:NOMIFUN_SERVER = 'http://127.0.0.1:19090'
$env:EXPO_WEB_TARGET = 'http://127.0.0.1:8081'
$env:PROXY_HOST = '127.0.0.1'
$env:PORT = '8788'
bun run proxy
```

前提是指定的 Relay 业务入口和 Expo web 已分别运行。端口均由联调进程所有者
选择；不要覆盖现有用户实例或把控制台端口当作业务入口。

## 恢复与能力

启动、前台恢复、实时重连和用户诊断均重新验证连接身份。
HTTP API / 授权状态与 WebSocket 同步状态分别显示。
WS 没有可靠事件重放，断链后重读 canonical Session 展示快照；
HTTP transport 不自动重放失败或结果未知的 POST。

Desktop 身份、所有者或数据世代改变后，Mobile 更换连接 epoch 和 SWR cache。
旧请求在响应和正文读取后检查原 epoch；迟到结果不能写入新连接的界面。
持久化的项目折叠状态与任务运行幂等键也按连接 namespace 隔离。
任务写操作绑定渲染该任务页面的连接 epoch。立即运行从本地幂等键申请到最终
POST 都携带同一 epoch；申请完成与调用者恢复之间切换目标也会在发送前拒绝。
旧页面回调和迟到回执不会请求新 Desktop、刷新其缓存或显示成功提示。
结果未知的运行只保留原 namespace 的幂等键，用户手动重试才再次发送。
配对、账号接入和换地址也从页面所属 epoch 开始，探测、动态加载兑换适配器、
显式地址 POST 和凭据提交始终携带它。提交后按本次新连接的 epoch 验证，
成功回执携带验证后的 epoch；其他目标抢先提交时，旧回执不会验证或覆盖新目标，
也不会触发旧页面导航。兑换完成后验证断网时保留已提交凭据，用户可明确诊断修复，
不重复兑换已用票据。撤销确认弹窗和“仅清除本机连接”同样绑定原页面的 epoch。
HTTP/WS 的授权失效回执携带发起请求或打开 socket 时的 epoch，清除操作在串行
持久化队列内同时校验该 epoch 和 JWT。同一 JWT 换到新地址时，已经排队的旧回执
不能清除新路由的凭据；当前 epoch 的真实授权失效仍立即退出连接。

语音沿用当前 `mobile-voice/v1` 接口及独立媒体传输。连接页只检查语音接口
版本，用户仍需在语音页选择支持的会话、配置服务商并主动授权麦克风。
连接探测不会启动音频设备，也不改造 Agent Runtime。

## 验收边界

离线门槛和真实堆栈入口见 [TESTING.md](TESTING.md)。本机真实 Relay / agent /
Desktop 联调必须覆盖登录、票据一次性消费、设备独立撤销及 WS 关闭、
组件重启恢复、结果未知的 POST 不重放、另一台 Desktop 与新数据世代隔离。

loopback 和浏览器验证不等于公网证书、真实 NAT / DNS、防火墙、Android/iOS
扫码权限、安全存储、系统深链或音频设备验收。Native 的 scheme 和安全存储
配置需要重新构建安装包；具体平台验收结果应由实际运行证据记录。
