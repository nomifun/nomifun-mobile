# Mobile 实时语音

2026-10-07用户另行明确授权本轮commit+push，允许当前Mobile/Desktop任务代码入库，覆盖本文此前验收前Git禁令。真实两云、设备/声学、完整工具宿主、Swift与用户验收仍pending；该授权不包含PR、发布、部署、可见GUI或原生app安装运行。

语音是独立、默认不连接的交互方式。打开会话标题栏的麦克风入口，明确选择已配对 Desktop 中的会话、语音模型和端点支持的 transport，保存独立 VoiceProfile，再点击开始。保存不录音、不连接模型，不写普通文字 Preset/Snapshot。已有文字 send、stop、model、stream 和会话 hook/API 保持原代码。

2026-10-07设备层按用户SDK-first决定重构：当前RN0.86.2/Expo57.0.11固定react-native-audio-api0.13.6（MIT），旧八份native bridge及Base64生产路径已撤。统一facade与默认false的voice-only SDK补丁源码已完成，定向行为、MSVC header及当前SDK Android Release/静态产物核对通过。真机生命周期、声学、Swift原生编译和云模型体验仍待验收；旧APK或SDK安装不作为当前实现的通过证据。

VoiceProfile 的工作纠正时机默认 `safe_boundary`；只有用户明确选择 `supersede_model_step` 才启用即时模型纠正。该策略由后端冻结在语音配置及工作准入中，只适用于语音启动的任务；既有文字任务的边界、工具生命周期及审批权限保持原行为。保存配置不会纠正已运行任务。

“测试语音连接”只在用户点击时对已保存、绑定及版本匹配的 Relay profile 发起独立 probe。它不创建 Mobile 音频设备，不开启麦克风，不触发工作；结果只说明实际模型连接、握手与关闭清理是否确认。RTC 需要实际设备 offer，本按钮不会把 RTC 配置降级为 Relay，也不把连接确认当作声学体验验收。

`src/features/voice` 使用 Desktop 独立生成的产品合同和 `/api/mobile-voice/v1`。媒体票据只放 `nomifun.voice.ticket.*` 子协议，不进入 URL、AsyncStorage 或业务 `/ws`；供应商 JSON/长期密钥和工作 Runtime 都只在 Desktop。RN 无可靠 `bufferedAmount` 证据时用 `input_admitted`/`input_released` 精确 duration credit；released 仅说明暂停后被丢弃的在途帧已归还额度，不计入模型准入指标，也不声称已被模型理解或听见。前台每秒向专属 media socket 发送 lease heartbeat。观察模式不获取麦克风、媒体或模型租约。

## 平台实现

- H5：真实 getUserMedia、独立采集/播放 AudioContext、AudioWorklet PCM 重采样、时长/年龄队列；RTC 只有设备 API 可用且 profile 精确选择该 transport 时启用。RTC 数据通道只满足中立 descriptor 的 SDP 要求，不收发供应商事件。
- Android/iOS：由固定AudioAPI SDK统一拥有PCM capture/play/context与设备权限，删除自写device/DSP engines。TypeScript facade适配既有VoiceMediaEndpoint，保voice/session/epoch/generation、实际格式、duration-age预算、SDK sample ID与服务器disposition credit、前台人工恢复及close unknown。
- SDK必要原生补丁默认false、只用于voice：跨JS/server ACK的原生duration-age额度、独立native age monitor与过期锁存、显式语音处理、后台/interrupt/route停设备且禁止自动mic复活、actual sink timestamp/flush和close unknown已接入。通过patchedDependencies持久化，不全局改变普通SDK caller；没有新device/DSP engine，不声称AEC音质或硬件清理已经验收。

Native transport仍为relay，语音模型由Desktop连接；当前音频SDK不是vendor SDK，手机不持模型私钥、不运行Agent。SDK或必需native保证未包含在binary时不能靠interface/Expo Go冒充可用端点；原生RTC不在本次新增范围，不静默改变transport。麦克风/音频设置权限用于前台语音，不加无限后台录音能力。设备SDK重构不重写UI、普通会话hooks/API或后端任务链；后续仅语音appearance/palette修正与本批Web证据见下文。

后台、锁屏、来电、设备/权限变化立即停止采样和 sink；Desktop 工作继续。返回前台不会自动重开麦克风。短前台租约补充进程死亡/JS 挂起时无法发 HTTP close 的情况。结束 voice、暂停 mic、停播和显式停止已显示原 Task 是四种独立操作。

Relay 模型重建期间，本地采样立即停止，界面显示恢复中及收音暂停；没有用于跨越重建的音频堆积队列。服务器释放已经发送的尾帧额度。恢复只在仍处于前台、用户收音意图未撤销、原语音/epoch 未变化、恢复事件已完成，并收到当前 HTTP 解除静音的匹配 `Ready + Capturing` ACK 后重新采样。新的恢复、暂停、后台或结束使迟到 ACK 失效；重建不会取消 Desktop 工作。

Played只能来自实际SDK/sink clock，保estimated/unknown精度与uncertain tail，不能用scheduled、软件出队、JS时间或普通完成callback代替实际消费；不同SDK context/sink timeline不合并成连续消费。不报告字级已听数量，不把一部分音频消费说成整句已听。source revision撤回使旧generation未播数据和字幕失效；已消费片段只保留timing tombstone与审计，撤出原文，用户字幕保留。RTC attachment重建保留原mic pause/off；不得自动取消静音。新SDK clock/flush已有源码与本地合同检查，实际设备消费、清理和听感仍待验收。

观察端以每次完整 projection 替换字幕正文，而非合并旧正文。`playback_receipts` 只呈现音频消费时长和精度；已撤回正文不会随下一次轮询复活，也不从不同来源 ID 的媒体消费回执推断字级已听内容。本地停播和输出 generation 变化使用同样的撤回规则。

来源时钟或任务关联无法确定时，取消/纠正先由 Desktop 阻止，并显示精确来源版本原文及目标任务 operation ID。Mobile 仅在持有语音的前台端点由人点击“确认这句话针对当前任务”，向独立 `/source-context` API 提交当前 voice/epoch、source revision 和 context key；观察端、无目标、缺失原文及过期要求均不能确认。新的要求、来源修订、语音关闭或 attachment 重建使旧确认失效；迟到确认不会清除新要求。确认不是工具/审批授权，也不等于工作已应用，后续仍以正式工作回执为准。

metadata委派遇有活动任务的模糊请求先澄清，不默认创建新任务；明确“新任务”与纠正原任务分别处理。ASR更高revision及模型新调用ID保持原工作身份，原语音来源的执行代际不会随任务恢复自动续租。当前来源卡片、换行确认按钮与原会话入口已完成隔离H5导出，源码可读性检查及行为测试不能代替真机视觉、键盘和声学验收。

## 可复现验证

### 当前共享UI原生产物

最新Android实际Release（48528）exit0/1m9s/576tasks，256src对应隔离副本与前后SHA、SDK69未变，6项真实包内核对及aapt2/ZIP16KiB通过。新包在build.noindex/voice-sdk-ui-20261007092140/nomifun-mobile-sdk-ui-release-test-arm64.apk，59976185B、SHA256 c2e51872ff5e4cb6e7feb3cac45c71db436aebdf001d34cf525afbd080b4afa6。同目录current-ui-packaging.json/build-owner-terminal.json与previous-*保留来源、实际终态和旧包；当前Hermes已嵌入，TEST签名、未安装或运行，不证明设备或声学。

当前iOS JS/Hermes报告在build.noindex/voice-ios-js-current-20261007-7f21c9/report.json：2137modules/46assets/5794000B，SHA25657a3c77d24f4d0d246014fd7c717a9f74888a3c17bba906a89594e5d0b8ce864，266源输入与1394SDK文件前后一致，进程/子进程已结束。它未编译Swift/native iOS包或运行真机。当前UI打包以新目录为准，旧APK不补新源码；Webui9/15项与真实体验pending保持原结论。

无需启动 GUI：

```sh
bun install --frozen-lockfile
bun run typecheck
bun test ./src/features/voice/controller.test.ts ./src/features/voice/profile.test.ts ./src/features/voice/media/media.test.ts ./src/features/voice/media/audio-api-endpoint.test.ts ./src/features/voice/diagnostics.test.ts
bun run check:i18n
bunx --no-install expo-modules-autolinking resolve --platform android --json
bunx --no-install expo-modules-autolinking resolve --platform apple --json
bun run voice:web:export --out-dir build.noindex/voice-web-<fresh-name>
```

### RN Web 隔离验收

此流程只针对现有 `refactor/nomifun-mobile` 的 RN/Expo Web。用户已授权隔离、无头 Chromium 验证；仍不启动可见 GUI、Tauri、原生应用、模拟器或 ADB，不安装 APK，不 commit/push。Desktop 只提供 API，不用 Desktop renderer 做手机布局验收。

使用 `voice:web:export --out-dir` 生成**新的** `build.noindex` 导出目录，导出前后核对当前 `src/public/plugins` 和配置、依赖锁的 SHA；源码变化或目录已存在都会拒绝认证。`e2e:voice-web` 再检查该源码标记，不能借用旧静态导出。Bun 只用于 Expo 导出及验收媒体模块打包；静态/API/媒体 WS 服务器与浏览器 runner 使用 Node。当前 Bun 1.3.14 的 `node:http` 升级层未通过媒体 WS 转发，服务器会在监听前拒绝该运行时。

操作步骤与完整参数见 [TESTING.md 的 RN Web 语音隔离验收](TESTING.md#rn-web-语音隔离验收)。核心命令为：

```powershell
# 在 nomifun-mobile 根目录；每次选择新的 export/report 目录。
bun run voice:web:export --out-dir "build.noindex/voice-web-<fresh-name>"
$env:NOMI_E2E_PLAYWRIGHT = "<外部运行时根目录，含 node_modules/playwright>"
$env:NOMI_E2E_EXECUTABLE_PATH = "<该运行时的 Chromium 可执行文件完整路径>"
node e2e/voice-web.mjs --export-dir "build.noindex/voice-web-<fresh-name>" `
  --backend-url "http://127.0.0.1:<本次实际端口>" `
  --data-dir "<本次独立 backend data 的绝对路径>" `
  --report-dir "build.noindex/voice-web-report-<fresh-name>"
```

后端必须是当前源码对应、单独启动的 `nomifun-web --api-only --host 127.0.0.1 --port 0 --data-dir <fresh-data>`，保留认证默认值。读取该 data 根的真实 `port.json`，同时保存真实源码/二进制比对产生的 `backend-source-evidence.json`；不能手填“匹配”以过门禁。**每个 data 根各用一个预先创建、已存在的 workdir**，通过该子进程的 `NOMIFUN_WORK_DIR` 指定。重跑完整 UI 验收时重新分配 data/workdir，不复用已有安装、共享工作根、改 lineage 或清库。runner 会拒绝已初始化安装，不使用真实账号或模型凭据。

Node 服务器只监听 `127.0.0.1:0`，报告实际端口。它维持原 Host、Origin、认证头、cookie 和媒体票据子协议，API/业务 `/ws`/voice media WS 仍由 Desktop 校验。启动 `ready` 只证明静态资源及本地监听就绪，不证明后端、模型或麦克风可用。runner 在 finally 中关闭其浏览器/context/代理；API 后端由启动它的进程持有者单独优雅关闭，并另存 PID、监听与退出证据。不得停止别的服务。

当前 API-only 宿主尝试创建普通 General Agent 时实际返回 HTTP 422 / `CAPABILITY_NOT_MATERIALIZED`，缺少原生 `system.browser_use` owner。验收仅在这个已验证分支，显式调用真实 canonical API 创建官方 `chat.minimal` 测试会话；不改 Mobile 普通默认，不伪造 native role，不将它当作 General 工具链通过。

证据分层：真实 RN Web UI 与真实、隔离的 Desktop API 证明首次设置、canonical 测试会话、文字草稿保留、语音入口/保存/启动的默认不录音行为、无 Voice store、专属错误隔离和样式表现。媒体页面使用 Chromium 合成 WAV 设备和生产 Web endpoint/AudioWorklet，配合**模拟** disposition，验证 PCM、时长/年龄 credit、阻塞后的过期尾帧、停播 generation 与关闭 track；没有云 ASR、真实人声/扬声器、AEC 或“用户已听到”的证据。报告将 `cloud_calls=false`、物理音频/原生待验以及 p50/p95 空值保留。

2026-10-07 新源码批次已完成：仅语音使用稳定 `useSyncExternalStore` appearance 订阅，通过 Screen/Button 的可选 `themeColors` 传入显式 palette；普通调用继续使用原默认 `useTheme`，Main 会话/API/hooks 未改。导出 `build.noindex/voice-web-export-20261007-ui8` 包含 50 routes、1768 Web modules，源码清单 264 份；在同一源码/导出上的最终报告 `build.noindex/voice-web-evidence-20261007-ui9/report.json` 的 15 项检查全部通过（7 项 UI/API、8 项媒体）、page_errors=0。Chromium 149.0.7827.55 的 `voice-phone.png`、`voice-wide.png`、`voice-phone-dark.png` 已实际查看；动态 light→dark→light 切换验证通过。新增实际 worklet 边界：没有 ACK 时仅交付 2 帧、未超过 60ms 额度；同步提交 100ms 播放会在 60ms 的 JS→worklet 预算边界失败关闭。相关 31 项定向测试/173 assertions 与最新 typecheck 通过。Node server 的 8 项实际网络测试通过，Node 下另有一项 Bun-only guard skip，不能把 skip 计入网络通过项。此前 ui8 的 13 项报告保留，当前结果以 ui9 为准。

本批报告 SHA256 为 `860bde0a8e6ceceabc6144727a61eb7af8c0faf38f06796b2793f8d2f5cfd2a8`，生产 Web endpoint 验收 bundle SHA256 为 `563f3abc50a2431277e448e5fb082ef9dbc0da6b09caf00c2200a7e6f52a5e0f`。报告确认 browser/context/proxy 关闭；同目录 `backend-close.json` 记录实际 SIGINT 与应用清理，以及 PID 36056/端口 60007 均不存在。PTY exit1 诚实保留，未冒充 Rust exit0。

本批 SDK 原生源码/持久补丁未改。既有 SDK Android APK 绑定的是此前构建源快照，未包含这轮 UI 改动，不能认证新 UI。15 项本地 Web 结果不包含两厂商真云工作回执、真实输入/外放/AEC/听感、原生设备生命周期、iOS 原生编译、LAN/TLS、并发负载或用户验收；这些仍 pending，整个 Goal 未完成。JS 阻塞检查只证明过期 PCM 不交付，AudioWorklet 不能调用 MediaStreamTrack.stop，不能把它写成阻塞期间硬件麦克风已关闭。

<!-- RN_WEB_ACCEPTANCE_CURRENT_BATCH: 20261007-ui9; export-ui8/source264/checks15/UI7/media8; Node network8; exact report and close evidence above. -->

当前原生build必须包含固定AudioAPI SDK及必要voice-only保证。2026-10-07用户已批准接受Android SDK许可；当前refactor/nomifun-mobile使用RN0.86.2/Expo57.0.11，隔离JDK17、SDK36、Build Tools36.0.0（AGP另需35.0.0）、platform-tools、CMake3.30.5及NDK27.1.12297006已由官方包校验并真实安装。没有全局安装，也未修改另一clone。当前SDK接线/本地行为/Android编译已有独立证据，不能沿用旧bridge源码结论。AudioAPI属于RN package，应以生成RN PackageList中的AudioAPIPackage核对实际注册，不用ExpoModulesMap代替SDK注册证明。

当前SDK补丁为 `patches/react-native-audio-api@0.13.6.patch`，package.json的patchedDependencies固定引用；SHA256 `d4f2119bead586f8371f2c329b473a4b9a87c7da82e5d43163bfae0af939b1ef`。endpoint定向17项/89 assertions，Mobile合计50项/259 assertions、typecheck和i18n通过。MSVC实际编译运行SDK header13组/71 checks，覆盖额度、ACK、会话隔离、耗龄锁存与native monitor；它不证明RN runtime或音频硬件。

当前SDK的隔离短副本 `C:/nomi-v-dc8670c5` 实际 `:app:assembleRelease`（59455）exit0，4m49s、576tasks（510执行、66up-to-date）。6项只读产物检查全部通过，绑定253份Mobile src、相对官方包69份SDK修改（57非iOS、12 iOS）、source freeze、补丁/lock与副本；实际DEX class_defs包含AudioAPIModule且无旧NomiFunVoiceAudioModule，RN PackageList注册AudioAPIPackage。包内实际AArch64 SDK shared library与Hermes已核对，APK bundle与该构建生成文件SHA一致。

当前SDK APK在 `build.noindex/voice-sdk-verified-20261007/nomifun-mobile-sdk-release-test-arm64.apk`，59974745字节，SHA256 `c75166268c7b287cc6a4bb0bab1dbf20a1fc980e6d29a4e7d8e06c4237bfd08d`；同目录保留sdk-artifact-evidence.json、Gradle日志、最终Manifest、zip/ELF alignment与voice-policy-result.json。aapt2确认两音频权限、usesCleartextTraffic=true，无foreground service权限/服务或debuggable=true；ZIP16KiB和29个ELF PT_LOAD16KiB静态检查通过。仍为Expo模板TEST签名，未安装或发布，不证明真机页大小或音频体验。

当前SDK H5 export50routes在短副本sdk-web-export；iOS JS export2135modules/5792310字节Hermes在sdk-ios-export，后者不等于Swift/Xcode/CocoaPods原生构建。实际SDK兼容修复包括RN CXX flags语种/ctor次序、未启用FFmpeg guard及vendor release assertion unused显式 `(void)`；Git Bash只加入本构建进程PATH，未关-Werror、未降版本或改系统PATH。源码、本地与Android静态证据已完成，真实设备/两厂商/视觉/声学/性能与用户验收仍pending。

HEAD的app.json已有允许HTTP连接的意图，但Expo57不消费android.usesCleartextTraffic；最小修复是由正式config plugin写入既有设置。实际离线prebuild通过，生成的正式main Manifest含usesCleartextTraffic=true、RECORD_AUDIO与MODIFY_AUDIO_SETTINGS。普通会话hooks/API和音频模块保持原行为；此项不证明LAN/TLS、正式生产签名或声音体验已验收。

以下为SDK重构前证据，继续保留。旧自写音频module的compileDebugKotlin通过（2m2s、59tasks）；补上游Markdown漏声明的固定punycode2.3.1后，Android/iOS导出2138/2059模块、约5.8/5.6MB Hermes。独立短副本C:/nomi-v-26c74720完成Android Debug arm64 APK（7m46s、359tasks实际执行），失败日志及当时源身份保留，原项目未移动或清理。

重构前Debug产物在build.noindex/voice-android-verified-20261007/nomifun-mobile-debug-arm64.apk（91371370字节、SHA256 939fabf362addefdc586d180002583b3b98873a69dd75b667fac622589db3eb3）；同目录日志、7项只读报告及aapt2包内Manifest证明当时DEX类、Expo注册与音频权限，8个模块源与当时产品SHA一致。

重构前assembleRelease（83661）exit0，耗时7m51s、569tasks（523执行、46up-to-date）。2138模块以dev=false经Hermes -O嵌入APK，assets/index.android.bundle为4812488字节；8个voice源SHA与当时产品一致。离线Release在build.noindex/voice-android-release-verified-20261007/nomifun-mobile-release-test-arm64.apk，56630782字节，SHA256 eaf5c9fda34a478a1a091907811e0a56b13e6c61ff0186a1181f19b769b354fb。同目录日志、android-release-evidence.json、root-supplement.json、最终Manifest与alignment记录保留，7项只读release证据全部通过，证明该旧包DEX/Expo注册、嵌入JS及27个arm64 .so，不能证明新SDK通过。

aapt2确认Release包内RECORD_AUDIO、MODIFY_AUDIO_SETTINGS、usesCleartextTraffic=true且无debuggable=true；zipalign -c -v -P16 4成功，27个ELF64 PT_LOAD alignment均不小于16KiB且offset/vaddr同余静态检查通过，不能当作真机16KiB页或声音证明。Release variant仍使用原Expo模板TEST签名，不是正式生产签名或发布；未读取生产签名key，正式签名须另获授权。iOS Hermes导出不代替macOS/Xcode/CocoaPods的Swift编译。这些是重构前的历史包证据，不认证当前 SDK 或新 UI。当前允许隔离无头 Chromium；可见 GUI/Tauri/原生应用、模拟器、ADB、安装应用及 commit/push 仍禁止。

旧八份bridge源码与原生audit一并归档到Desktop/build.noindex/voice-sdk-refactor-20261007/previous-voice-audio，退出当前生产路径与开发输入。当前SDK重构详见 [SDK补充](../../nomifun-desktop/docs/specs/2026-10-07-mobile-voice-sdk-refactor.zh.md)；当前源码身份、默认false兼容、额度/时钟/生命周期本地行为及Android编译已有上述独立证据，Swift原生与设备验收仍须完成，不能复用旧bridge的清理声明。

真实验收需要两个厂商凭据/模型权限、配对 LAN 与远程 TLS、Android/iOS/H5 设备，验证 microphone consent、AEC 外放/耳机、语音时长/年龄/断网、锁屏/来电/拔插、观察与接管、原 Task 目标纠正/取消、具体审批、source 撤回、实际 playback receipt、关闭资源与 p50/p95。纯模块 harness、静态导出、编译或握手不证明上述体验通过。

SDK依据：[react-native-audio-api官方源码](https://github.com/software-mansion/react-native-audio-api)、[SDK文档](https://docs.swmansion.com/react-native-audio-api/)、[Expo Autolinking](https://docs.expo.dev/modules/autolinking/)。pin、持久补丁、本地行为与Android静态结果均有证据，真实设备和完整体验仍待验证。
