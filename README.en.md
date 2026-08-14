# nomifun-mobile

(English | [中文](README.md))

NomiFun Mobile is the Android, iOS, and H5 pocket client for
[NomiFun Desktop](https://github.com/nomifun/nomifun-desktop), built with Expo
and React Native. Desktop keeps the models, Agents, companions, tasks, files,
and long-running execution; Mobile uses the same authenticated HTTP/WebSocket
surface as Desktop WebUI.

On a trusted LAN, Mobile connects directly to Desktop. Across networks, it can
connect through a business tunnel provided by a user-deployed
[NomiFun Net Infra](https://github.com/nomifun/nomifun-net-infra) relay.

## The NomiFun open-source family

| Project | Responsibility | Product and documentation |
|---|---|---|
| [NomiFun Desktop](https://github.com/nomifun/nomifun-desktop) | Local AI and data source of truth; runs models, Agents, companions, tasks, tools, and open interfaces | [Product page](https://www.nomifun.com/products/desktop/) · [WebUI access](https://github.com/nomifun/nomifun-desktop/blob/main/docs/guides/webui-remote-access.md) |
| **NomiFun Mobile (this repository)** | Android, iOS, and H5 interface for Desktop sessions, tasks, requirements, companions, and models | [Product page](https://www.nomifun.com/products/mobile/) · [Connectivity boundary](docs/research/connectivity.md) |
| [NomiFun Xiaozhi Yuntai](https://github.com/nomifun/nomifun-xiaozhi-yuntai) | ESP32-S3 robot and pan-tilt surface for voice, motion, and physical interaction | [Product page](https://www.nomifun.com/products/xiaozhi-yuntai/) · [Desktop integration](https://github.com/nomifun/nomifun-desktop/blob/main/docs/guides/xiaozhi-robot.md) |
| [NomiFun Net Infra](https://github.com/nomifun/nomifun-net-infra) | Self-hosted NomiRelay infrastructure for reaching Desktop or other HTTP/WebSocket/TCP/UDP services behind NAT | [Product page](https://www.nomifun.com/products/net-infra/) · [Portal guide](https://www.nomifun.com/docs/guides/net-infra/) · [Relay integration](docs/RELAY-INTEGRATION.md) |

## Architecture and connection boundary

- Desktop is the only application-data and execution hub. Mobile does not copy
  the engine or the complete dataset.
- Queries and commands use HTTP `/api/*`; streaming replies and incremental
  state use one authenticated WebSocket `/ws`.
- Preferred pairing scans Desktop's short-lived, one-time QR login URL and
  exchanges it for a time-limited JWT.
- On a trusted LAN, connect directly to Desktop. Across networks, use a
  self-hosted NomiRelay, VPN/Tailscale, or an HTTPS/WSS reverse proxy.
- Mobile connects only to the relay **business endpoint**. It never stores or
  calls the relay admin password, enrol token, SPKI pin, or console API.
- The current raw LAN listener and a non-TLS-terminating raw relay tunnel carry
  plain HTTP. Public production use requires HTTPS/WSS or an equivalent trusted
  network boundary.

Read [Relay integration](docs/RELAY-INTEGRATION.md),
[pairing URL contract](docs/PAIRING-URL.md), and
[connectivity and authentication](docs/research/connectivity.md) before
deploying cross-network access. A loopback test does not validate public DNS,
firewall, certificate, persistence, or revocation behavior.

## Features

- sessions, projects, streaming replies, and message search;
- scheduled tasks and execution history;
- requirement queues and state transitions;
- companions, providers, and models;
- customer-service configuration and monitoring;
- completion notifications on native and H5.

## Development

Start a Desktop/WebUI-compatible server, then:

```bash
bun install
bun run dev
```

The H5 development proxy listens on port `8788` by default. Native clients use
an absolute Desktop or relay-business-endpoint address; H5 must be deployed
same-origin with the API.

Useful verification commands:

```bash
bun run typecheck
bun test
bun run check:i18n
bun run export:web
```

## Community

- Website and product docs: [https://www.nomifun.com](https://www.nomifun.com)
- Issues: [nomifun-mobile Issues](https://github.com/nomifun/nomifun-mobile/issues)
- Email: [535526063@qq.com](mailto:535526063@qq.com)
- WeChat group: scan the current repository QR code below.

![NomiFun WeChat group QR code](docs/assets/nomifun-wechat-group.jpg)
