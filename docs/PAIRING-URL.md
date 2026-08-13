# Mobile pairing URL（最小协议）

本文档定义 Mobile 已支持的最小配对包。它不新增 Relay API，也不改变
Desktop 现有的 QR 登录接口。

## 格式

```text
nomi://pair?v=1&url=<percent-encoded Desktop QR URL>
```

其中嵌套的 Desktop QR URL 必须仍然是：

```text
http(s)://<desktop-or-relay-business-entry>/qr-login?token=<hex token>
```

示例（仅示意，token 不应写入日志或长期保存）：

```text
nomi://pair?v=1&url=https%3A%2F%2Frelay.example.com%3A19090%2Fqr-login%3Ftoken%3D...
```

`v=1` 和 `url` 是唯一允许的字段。Mobile 会拒绝：

- Relay admin 密码、长期 enrol token、JWT 或直接 `token` 字段；
- 非 `http`/`https` 的嵌套地址；
- 非 Desktop `/qr-login` URL；
- 重复字段、未知字段、凭据、fragment 或错误版本。

## 兑换语义

`parsePairingUrl` 只做纯解析，不发请求，也不保存任何凭据。
`redeemConnectionPayload` 同时接受：

1. 现有 Desktop QR URL；
2. 上述 `nomi://pair` 包装 URL。

兑换时只把 `baseUrl` 和一次性 `qrToken` 交给现有
`POST /api/auth/qr-login`；成功响应中的 Desktop JWT 继续由既有连接存储层
保存。Pairing URL 原文、Relay admin 密码和 enrol token 不会写入
`AsyncStorage`。

## Desktop/Relay 约束

本轮只修改 Mobile。Desktop 可以继续生成原来的
`https://.../qr-login?token=...`；如果未来要生成配对包，只需把该完整 URL
按上面的格式编码即可，不需要修改 Relay 或引入管理端 API。
