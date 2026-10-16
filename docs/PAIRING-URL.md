# Mobile 配对 URL

配对链接携带一次性设备配对票据。Mobile 通过 Desktop 的设备认证端点兑换，
Relay 只转发 Desktop 业务流量，不参与票据签发或验证。

## 当前格式

```text
nomifun://pair?v=1&url=<percent-encoded Desktop device-pair URL>
```

内层地址为：

```text
http(s)://<desktop-or-relay-business-entry>/device-pair?token=<hex ticket>
```

示例仅表示结构，不包含可用票据：

```text
nomifun://pair?v=1&url=https%3A%2F%2Frelay.example.com%3A19090%2Fdevice-pair%3Ftoken%3D...
```

`nomifun` 与 Expo 应用注册的 scheme 一致。外层只接受唯一的 `v=1` 和 `url`，
拒绝端口、凭据、fragment、额外路径、重复字段和未知字段。
内层设备配对 URL 只接受 HTTP(S)、唯一 hex `token` 和 `/device-pair` 路径，
拒绝 URL 用户名/密码、fragment 和额外参数；末尾 `/` 可被规范化。

## 兼容边界

纯解析层仍识别旧 `nomi://pair` 包装和直接 HTTP(S) URL。
旧 `/qr-login?token=…` 也能被识别，返回 `credentialKind: 'qr-login'`，
便于给用户旧连接码的恢复提示。现有 browser QR 的尾斜杠、附加参数和
路径前缀解析行为保留；解析结果仍只取 origin，不表示支持路径前缀部署。

解析兼容不代表认证降级：默认兑换始终调用
`POST /api/auth/device-pair`，不会失败后自动调用 `/api/auth/qr-login`。
旧 WebUI 的浏览器票据不能因此变成设备凭据；应从 Desktop 的手机连接入口
获取新的配对码。应用配置同时注册 `nomifun` 和 `nomi` 别名；新链接只生成
`nomifun`。旧 scheme 的系统拉起仍需要安装包含这份配置的新 Native 构建。

## 兑换与 H5 同源校验

`parsePairingUrl` / `parseConnectionPayload` 只做纯解析。
`resolveConnectionPayload(raw, { currentOrigin })` 在兑换前校验目标 origin：

- Native 不提供 `currentOrigin`，保留解析出的完整 HTTP(S) origin。
- H5 必须提供当前 origin；相同 origin 才允许使用相对 API 地址 `''`。
- 不同主机、scheme、端口，以及不可用或非法的当前 origin，均在请求前拒绝。
- origin 使用标准 URL 规范化，默认端口和 IPv6 等价表示不会造成误判。

`redeemConnectionPayload(raw, expectedEpoch, exchange?, options?)` 会先执行这个校验。
H5 不得跳过校验，把其他电脑的票据发送到当前站点。
UI 传入渲染该接入入口时的连接 epoch；它贯穿动态加载、探测、兑换和凭据提交，
不能在 await 之后重新捕获另一台 Desktop 的 epoch。
注入的兑换适配器接收 `(baseUrl, qrToken, expectedEpoch)`，也可通过
`{ redeem(parsedPayload, expectedEpoch) }` 读取完整的解析结果。
本地 helper 成功返回 `{ user, epoch }`，其中 epoch 属于本次已提交并验证的连接；
UI 仅在该回执仍是当前 epoch 时显示成功或导航。该回执不是新的 HTTP 响应格式。

默认设备兑换请求为：

```text
POST /api/auth/device-pair
{ qr_token, device_name, protocol_version: 1 }
```

成功响应携带 Desktop 用户、JWT 和设备身份。认证层负责保存连接绑定，
原配对 URL、一次性票据和 Relay 管理凭据不会长期保存或写入日志。
无效输入和同源校验错误的错误消息不包含原 URL 或票据。

账号登录和首次初始化分别使用 `POST /api/auth/device-login` 与
`POST /api/auth/device-setup`，请求为
`{ username, password, device_name, protocol_version: 1 }`。
两条路径同样只保存独立设备凭据，H5 请求使用 `credentials: 'omit'`，
不保留浏览器管理会话作为设备撤销后的备用认证。

## 扫码与深链接收

`isPairingAppLink` 只识别 App 配对路由；即使参数不合法也允许接收层把用户
带入配对错误界面，完整校验仍由配对解析层完成。
`PairingAttemptLock` 在解析或异步请求之前同步获取锁，可供相机和冷/热启动
深链接收使用。

第一次扫描后暂停相机回调。无效码、过期码、网络失败均保持暂停，必须由
用户点击“重新扫描”恢复；镜头持续对准同一码不会自动重复兑换。进行中的
请求和成功状态不能被重置。相机权限永久拒绝时入口改为系统设置，返回 App
后重新读取权限。

纯测试覆盖解析、origin 拒绝和锁的状态变化；相机回调、系统权限与操作系统
冷/热启动链接仍需要 Android/iOS 真机验收。
