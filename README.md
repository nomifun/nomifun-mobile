<a name="top"></a>

<div align="center">

<img src="assets/images/icon.png" alt="NomiFun Mobile" width="120">

<h3>NomiFun 的 Android / iOS / H5 移动客户端</h3>

<p>
  手机作为遥控器，随时随地驱动你的本地 AI 工作站 ——<br/>
  会话、任务、需求、伙伴与模型，全部由电脑上的 <b>NomiFun Desktop</b> 承担。
</p>

<p>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache_2.0-FF6F91?style=for-the-badge"></a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20H5-7583B2?style=for-the-badge">
  <a href="https://www.nomifun.com"><img alt="Website" src="https://img.shields.io/badge/Website-nomifun.com-FF6F91?style=for-the-badge"></a>
</p>

<p>
  <img alt="Expo 57" src="https://img.shields.io/badge/Expo-57-000020?style=flat-square&logo=expo&logoColor=white">
  <img alt="React Native 0.86" src="https://img.shields.io/badge/React_Native-0.86-61DAFB?style=flat-square&logo=react&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white">
</p>

<p>
  <b>简体中文</b>&nbsp;·&nbsp;<a href="README.en.md">English</a>
</p>

<p>
  <a href="https://www.nomifun.com">🌐 官网</a>&nbsp;·&nbsp;
  <a href="https://www.nomifun.com/zh/docs/">📖 文档</a>&nbsp;·&nbsp;
  <a href="#-快速开始">🚀 快速开始</a>&nbsp;·&nbsp;
  <a href="https://github.com/nomifun/nomifun-desktop">🖥️ Desktop</a>&nbsp;·&nbsp;
  <a href="https://gitee.com/nomifun/nomifun-mobile">🇨🇳 Gitee 镜像</a>
</p>

</div>

---

**NomiFun Mobile** 是 [NomiFun Desktop](https://github.com/nomifun/nomifun-desktop)
的 Android / iOS / H5 客户端。它是一个**薄客户端**：业务逻辑、模型、数据
和长时间任务全部运行在 Desktop 上；Mobile 通过同一套 HTTP + WebSocket API
渲染状态、下发指令——不重复实现引擎行为，不在手机上保存第二份数据或模型
凭据。

局域网下手机与 Desktop **直连**，不经过任何 NomiFun 云端中转：桌面端打开
「连接与设备 → 连接手机」后，Mobile 扫一次性二维码或用账号密码登录，
即可实时使用同一套会话、任务、需求、伙伴和工具。

---

## 🖼️ 产品速览

<div align="center">

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/01-connect.png" alt="连接桌面端"><br/><sub><b>连接桌面端</b> · 扫码配对 / 粘贴连接链接 / 账号登录</sub></td>
    <td width="33%"><img src="docs/screenshots/02-sessions.png" alt="会话列表"><br/><sub><b>会话</b> · 与 Desktop 共享的收件箱，按项目、伙伴分组筛选</sub></td>
    <td width="33%"><img src="docs/screenshots/03-chat.png" alt="对话"><br/><sub><b>对话</b> · 流式回复、工具调用与审批实时推送</sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/04-composer.png" alt="输入与选模型"><br/><sub><b>输入与选模型</b> · 手机也可以为每个会话挑模型</sub></td>
    <td width="33%"><img src="docs/screenshots/13-voice.png" alt="实时语音"><br/><sub><b>实时语音</b> · 与 Agent 直接对话，纠正时机与安全边界可配</sub></td>
    <td width="33%"><img src="docs/screenshots/12-directory-picker.png" alt="选择工作目录"><br/><sub><b>项目会话</b> · 在手机上浏览桌面端真实文件系统、绑定工作目录</sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/05-tasks.png" alt="定时任务"><br/><sub><b>任务</b> · 定时任务启停、调度规则一目了然</sub></td>
    <td width="33%"><img src="docs/screenshots/06-requirements.png" alt="需求"><br/><sub><b>需求</b> · 无人值守自动化入口，状态看板跟进</sub></td>
    <td width="33%"><img src="docs/screenshots/07-companions.png" alt="桌面伙伴"><br/><sub><b>伙伴</b> · 桌面端养成的伙伴，手机上随时聊</sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/14-companion-detail.png" alt="伙伴详情"><br/><sub><b>伙伴成长</b> · 等级、经验、记忆与形象，全量同步桌面端</sub></td>
    <td width="33%"><img src="docs/screenshots/09-models.png" alt="模型管理"><br/><sub><b>模型管理</b> · 供应商、默认模型、凭据状态</sub></td>
    <td width="33%"><img src="docs/screenshots/10-customer-service.png" alt="客服"><br/><sub><b>客服</b> · 面向访客的安全问答员工，高危能力不注册</sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/08-more.png" alt="我的"><br/><sub><b>我的</b> · 当前站点、外观、通知与版本信息</sub></td>
    <td colspan="2"><sub><b>截图即实物</b><br/>以上画面截自 H5 构建真实连接桌面端的运行实例（2026-10-10），非设计稿。重拍方式见<a href="#验证">验证</a>一节。</sub></td>
  </tr>
</table>

</div>

---

## 🚀 快速开始

### 在手机上使用（正式方式）

1. 在 Desktop 中打开 **连接与设备 → 连接手机**，选择同一网络直连
   或已配置的中继入口。局域网地址形如 `http://<电脑IP>:25808`；账号登录
   所需的用户名和密码可在 **连接与设备 → 其他电脑浏览器** 中查看或配置。
2. 打开 NomiFun Mobile，任选一种方式连接：
   - **扫码配对**：扫桌面端面板里的一次性二维码（有效期以面板倒计时为准）；
   - **粘贴连接链接**：把桌面端给出的链接粘进「粘贴连接链接」；
   - **账号登录**：输入 `http://<电脑IP>:25808` 和面板上的用户名、密码。
3. 登录后即可使用会话、任务、需求、伙伴等全部功能。桌面端保持唤醒，
   定时任务才会按点运行。

> [!TIP]
> 跨网络访问（外出 4G/5G）可自建 [NomiFun Net Infra](https://github.com/nomifun/nomifun-net-infra)
> 中继；Mobile 支持 Relay 配对 URL，见 [Relay 集成契约](docs/RELAY-INTEGRATION.md)。

### 本地开发（H5 预览）

需要 [Bun](https://bun.sh) ≥ 1.3.13，以及一个正在运行的桌面端或
`nomifun-web` 后端。

```bash
git clone https://github.com/nomifun/nomifun-mobile.git
cd nomifun-mobile
bun install

# 同一个命令同时拉起 Expo web (:8081) 和 API 同源代理 (:8788)。
# 桌面端在同一局域网时，把地址换成它的 WebUI 监听地址：
NOMIFUN_SERVER=http://192.168.3.69:25808 bun run dev
```

打开 `http://localhost:8788`（不是 Metro 的 8081——代理把 App 和 API
放到同一 origin），用桌面端「连接与设备 → 其他电脑浏览器」面板上的
账号密码登录即可。H5 登录注册可独立撤销的设备，使用设备 JWT，认证请求
不携带浏览器 Cookie。手机连同一局域网时也可以
直接访问 `http://<本机IP>:8788`。

```bash
bun run android   # Android（需要 Dev Build / EAS，非 Expo Go）
bun run ios       # iOS（同上）
```

### 验证

| 命令 | 需要后端？ | 验证什么 |
| --- | --- | --- |
| `bun run check` | 否 | typecheck + `bun test` + i18n 一致性，提交前的离线门槛 |
| `bun run e2e` | **是** | H5 启动、登录、五个 tab 与次级页面全部渲染 |
| `bun run e2e:project` | **是** | 项目会话全流程（选目录、浏览、预览、大文件拒绝） |
| `node e2e/readme-shots.mjs` | **是** | 重拍本页的产品截图（`NOMI_E2E_SHOTS=docs/screenshots`） |

Playwright 不是仓库依赖，按需安装或用 `NOMI_E2E_PLAYWRIGHT` 指向机器上
已有的安装；环境变量、凭据和各脚本细节见 [docs/TESTING.md](docs/TESTING.md)。

---

## 📖 产品使用文档

安装、配对、连接、功能说明和用户排障统一维护在
[NomiFun Portal](https://www.nomifun.com/zh/docs/)：

- [Mobile 与 Desktop 直连](https://www.nomifun.com/zh/docs/guides/mobile-bridge/)
- [WebUI 远程访问](https://www.nomifun.com/zh/docs/guides/webui-remote/)
- [Net Infra 跨网络接入](https://www.nomifun.com/zh/docs/guides/net-infra/)

## 🛠️ 技术文档

- [Foundation](docs/FOUNDATION.md)
- [配对 URL 契约](docs/PAIRING-URL.md)
- [Relay 集成契约](docs/RELAY-INTEGRATION.md)
- [项目会话契约](docs/PROJECT-SESSIONS-CONTRACT.md)
- [Desktop 连接与设备指南](https://github.com/nomifun/nomifun-desktop/blob/main/docs/guides/webui-remote-access.zh.md)
- [WebSocket 协议研究](docs/research/ws-protocol.md)
- [文件浏览 API](docs/research/fs-browse-api.md)
- [工作区运行时](docs/research/workspace-runtime.md)
- [测试指南](docs/TESTING.md)

## ⚖️ License

[Apache-2.0](LICENSE) · NomiFun 是公益开源项目，个人与商用均免费，欢迎审计。

<p align="right"><a href="#top">回到顶部 ↑</a></p>
