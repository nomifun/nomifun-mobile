# Android 官方 APK 更新

本阶段仅发布完整 APK，不接入 Expo OTA，不新增原生下载器或安装权限。
App 的更新检查独立于 Desktop 连接、配对和业务 API；未连接或协议不兼容时也能进入更新页面。
App 从官方 GitHub Release 检查新版，打开该版本固定 APK 地址，由浏览器下载、Android 系统安装器确认覆盖安装。
打开下载地址只表示已交给系统，App 不宣称下载或安装成功；下次启动以实际原生安装版本和构建号确认结果。

## 发布事实和信任边界

- 官方订阅地址：`https://github.com/nomifun/nomifun-mobile/releases/latest/download/release-manifest.json`。
- `src/constants/releases.json` 是客户端和发布工具共享的仓库、包名、分发渠道、清单 schema、官方签名指纹配置。
- 清单沿用 `nomifun.mobile.release.v1`，新产物显式声明 `channel: stable`、`distribution: official-apk`、`android.assetName`。
- 稳定版本使用 `X.Y.Z`，tag 使用 `vX.Y.Z`，APK 名使用 `nomifun-mobile-X.Y.Z.apk`。下载地址由官方仓库、tag、文件名派生，不信任任意清单 URL。
- 安装版本、`versionCode`、SDK、签名、ABI 和文件摘要必须从最终 APK 提取。不得使用手工版本参数替代实际产物信息。
- 同一安装身份须保持包名、签名兼容，并递增 `versionCode`；EAS remote 管理构建号。修改包名、使用旧测试签名或换签名的包，不能承诺覆盖安装。
- 新包需要在构建配置中声明 `official-apk`。商店包、开发客户端、Expo Go 和未知分发身份不推荐官方 APK 覆盖升级。
- GitHub 地址不可达时显示检查失败；这不等于“已是最新”。不保存可重新推荐已撤回 APK 的历史清单。

原生安装版本及构建号由 `expo-application` 读取。源码产品版本以 `package.json.version` 为准，由 `app.config.ts` 派生 Expo 配置；它不能替代已安装 APK 的实际版本。

## 本地生成与核验

需要 Node.js、Android SDK Build Tools（`aapt2`、`apksigner`）、Java 和 `unzip`。工具优先探测 `--sdk`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`，再检查常见本地 SDK 目录。无需访问签名私钥、环境令牌或发布日志。

1. 在 `package.json.version` 提升产品版本，冻结本次源码并记录构建使用的完整 commit。完成本地检查，通过 `apk` 构建 profile 生成新 APK，再做所需设备验收。不要覆盖历史版本或已发布的 `0.1.2` 文件。

   ```sh
   eas build --platform android --profile apk
   ```

   本地构建可追加 `--local`；该 profile 继承的 `BUN_INSTALL_CACHE_DIR` 是 Linux 云端路径，本地构建前须在隔离构建配置中将它覆盖为当前主机可写的缓存目录，不能直接沿用该路径。
2. 把最终 APK 命名为 `nomifun-mobile-X.Y.Z.apk`。下例的 `0.1.3` 仅为新候选版本示例，不能代替实际构建结果：

   ```sh
   bun run release:manifest --apk build.noindex/release-0.1.3/nomifun-mobile-0.1.3.apk --out build.noindex/release-0.1.3/release-manifest.json --source-commit <构建使用的完整40位commit>
   bun run release:verify --manifest build.noindex/release-0.1.3/release-manifest.json --phase local --apk build.noindex/release-0.1.3/nomifun-mobile-0.1.3.apk
   ```

   目录须提前存在。生成器拒绝覆盖已存在的清单。`--source-commit` 是发布者从构建来源提供的溯源声明，APK 本身不能证明源码 commit；版本、签名、SDK、ABI、大小和 SHA-256 则都取自实际 APK。脚本验证 APK 签名有效、官方证书、包名、非 debug 状态，失败即停止。

3. 使用 `bun run test:release` 验证解析器、清单信任规则和公开文件的字节校验。常规发布仍需执行仓库要求的检查，脚本不代替设备验收。

生成器只创建本阶段需要的 Android 发布字段。原 v1 清单中的 Web 产物及人工验收记录可另行保留，但更新客户端不依赖它们，也不需要为手机更新新增 Desktop 数据表。

## 发布顺序

以下外部发布操作由获授权的发布者完成；这两个脚本只有本地写文件和公开网络读取能力，不上传、不修改 Release、不读取发布令牌。

1. 创建新版本的候选 Release，设为 **pre-release** 且 **不是 latest**。上传 APK，先不要上传正式清单。必须使用公开候选 Release；草稿资产需要鉴权，不适用于此匿名核验流程。
2. 核实固定地址下载到的真实 APK 与本地一致：

   ```sh
   bun run release:verify --manifest build.noindex/release-0.1.3/release-manifest.json --phase assets
   ```

   此步骤流式下载并计算 APK 摘要，校验字节数和 SHA-256，不只检查 HTTP 成功码。
3. 上传已验证的 `release-manifest.json`，再核实固定版本地址返回的文件与本地完全一致：

   ```sh
   bun run release:verify --manifest build.noindex/release-0.1.3/release-manifest.json --phase manifest
   ```

4. 设备验收完成后，取消 pre-release 标记并将该 Release 显式设为 latest。最后核实客户端订阅入口已经切换到该清单：

   ```sh
   bun run release:verify --manifest build.noindex/release-0.1.3/release-manifest.json --phase latest
   ```

不要让未核验的候选 Release 自动成为 latest。已发布产物保持不可变；遇到坏版本应发布更高构建号的修复版本。将 latest 指回旧 APK 不能让已安装用户自动降级。撤回版本时同时移除有问题的官方资产，并恢复可用订阅入口。

## 验收与现存安装

- 本次功能不能反向加入旧安装包。当前 `0.1.1`/`0.1.2` 安装需要先手动安装一次包含更新入口的新官方 APK；之后再使用 App 内检查和浏览器下载流程。
- 在真实 Android 设备从同签名旧版覆盖安装后，检查配对信息、登录数据和本地设置保留，随后读取新原生版本和构建号。
- 分别验证未连接、连接协议不兼容、离线、错误清单、无新版、有新版、取消浏览器和系统安装失败；系统拒装不能被 UI 显示为安装完成。
- 核实设备最低 SDK 与 ABI；不兼容时解释原因并禁止推荐安装。
- iOS、商店版和 H5 只展示各自可用的升级方式，本阶段不虚构未发布的商店渠道。
- 本次不增加 OTA 依赖、runtimeVersion、更新服务地址、定时 OTA 检查或相关发布流程。

没有设备安装验收和候选新 APK 时，应明确记录验证缺口。静态检查、历史 APK 解析和网络请求成功都不能替代实际覆盖安装结果。
