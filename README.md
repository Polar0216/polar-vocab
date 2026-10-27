# Polar Vocab

个人英语、德语词汇收集与间隔复习系统：GitHub Pages 静态 PWA、IndexedDB 本地优先、独立 GitHub 私有数据仓库，以及 Windows 桌面收词器。无需自建服务器、Serverless 或云数据库。

当前开发版本为 **Polar Vocab Capture 0.6.1 整合版**，基于原有工程增量整合划词反馈、英德词典、结构化义项、整句翻译、句中选词和本机安全授权。实际发布、真实服务及私库验收结果以 [整合发布报告](reports/integrated/INTEGRATED_RELEASE_REPORT.md) 为准；本地或模拟测试通过不代表正式网站或真实私库已经通过。旧程序、队列、测试数据与阶段报告继续保留；本轮不执行 iOS 验收。

## Windows 日常使用

本机已将整个工程收进外层 `polar-vocab/project/`；外层双击“启动Capture收词.lnk”使用收词器，双击“打开背词软件.url”使用[完整背词网站](https://polar0216.github.io/polar-vocab/)，外层“使用说明.md”解释各文件夹。原桌面入口已收回历史目录。直接程序仍位于本工程的 `artifacts/desktop/current/Polar-Vocab-Capture-0.6.1-win-x64.exe`。文件分类见[目录指南](docs/FOLDER_GUIDE.md)，最新实测见[整理与真实同步验收](reports/integrated/CLEANUP_AND_LIVE_ACCEPTANCE_20261027.md)。无需隔离启动器：正式数据目录固定为 `%APPDATA%\Polar Vocab\Capture`，SQLite 为 `captures.sqlite`；Chromium 缓存独立放在同级 `Capture.runtime`。具体路径也显示在设置页。

1. 正常退出旧版后双击新版；程序常驻托盘。默认快捷键 Ctrl+Alt+S，若被其他程序占用，可在设置更换，不需要删除旧程序或目录。
2. 在原应用选中人工文本后按快捷键。非激活反馈先显示，原生读取与词典、翻译异步进行；读取失败仍可手动输入或粘贴。
3. 选择单词、短语或整句模式。整句原文可点击单词，再核对词形候选、词性和独立义项；中文候选、例句、冠词等均可编辑。多个候选存在歧义时由用户选择。
4. 收藏先保存本机 SQLite，离线可用。句中词保留原词形、原句及其来源；只有明确勾选保留时才写入已核对的句译。机器翻译不作为词典或词形证据。
5. 需要同步时，在设置打开原生授权窗口，本人输入仅授权目标私库的 Fine-grained PAT；只读检查后确认，可选择「记住此设备」。不要将 PAT 发送到聊天、写入项目或 `VITE_*` 变量。

词典采用免 Key 的 WiktApi / Wiktionary，中文及整句候选使用独立 MyMemory Provider。查询文本会发给供应商处理，免费额度和许可并非无限；关闭「允许外部查询」后仍可手动编辑和离线收藏。无法取得的词性、德语冠词、复数和变位留空，不以词尾规则猜测。

新版只向私库 `captures/` 创建不可变采集批次，不写正式词库或 FSRS 状态。上传前必须在线确认正式网站的 `release.json` 支持采集及快照协议 1/2 与当前上下文字段；未确认时暂停上传、保留本机队列。Web 接收仍需预览并明确确认，重复事件按原身份去重。

首次启动只自动检测旧默认 `%APPDATA%\Polar Vocab Capture`。此前使用独立候选目录时，可在正式空队列通过「从旧队列迁入（仅空库）」选择旧数据库所在文件夹；不会自动扫描合并所有测试目录。迁移先做 SQLite 在线备份、校验和版本升级，保留原目录及回滚资料，不原地覆写旧库。新版物理版本为 2，旧版不得打开新版数据库。

[文本与词形流程](docs/INTEGRATED_TEXT_FLOW.md) · [本机迁移与回滚](docs/INTEGRATED_MIGRATION.md) · [安全授权](docs/INTEGRATED_AUTH.md) · [词典来源和许可](docs/DICTIONARY_PROVIDERS.md) · [采集协议](docs/CAPTURE_PROTOCOL.md)

## 本地开发

使用 Node.js 24 LTS（24.0 以上、25 以下）与 npm 11。所有模块共用根目录精确锁文件，不混用包管理器。

```sh
npm ci
npm run dev
```

Web 开发地址由终端输出，默认 `http://127.0.0.1:5173/`；开发模式不注册 Service Worker。生产预览默认 `http://127.0.0.1:4173/polar-vocab/`，使用 `#/inbox` 等 Hash 路由。首次联网等待外壳缓存完成后才具备基础离线能力。

```sh
npm run check
npm run test:desktop
npm run desktop:build
npm run preview
```

桌面开发和打包仅在 Windows x64 执行，需系统 .NET Framework C# 编译器及 UI Automation 程序集：

```sh
npm run desktop:dev
npm run test:desktop:e2e
```

保留旧便携版时，按 [开发文档](docs/DEVELOPMENT.md) 选择全新打包输出目录；不要直接覆盖旧产物或日常 profile。便携版未签名，未自动创建 GitHub Release。

浏览器回归先安装 Chromium，再运行 `npm run test:e2e`；已有 Edge 时可设置 PowerShell `$env:PLAYWRIGHT_CHANNEL='msedge'`。手机项目是窄屏浏览器模拟，不等于 iPhone 真机。实际测试必须使用独立输出目录，Playwright 会清理指定输出目录，不能放真实备份或日常 profile。

## Web 词库和复习

生词箱支持本机录入、剪贴板与 CSV/TXT/XLSX 导入；均先检查再确认。词条可整理义项、例句、标签及英德结构字段，整理不会自动创建复习卡片。「加入复习」后使用 Again / Hard / Good / Easy 评分。FSRS 锁定 ts-fsrs 5.4.2，卡片、评分事件和待同步操作在同一事务保存；本轮没有修改算法或重建复习历史。

Web 通过 GitHub Contents API、SHA 检查、三方合并、持久化上传批次与显式冲突决议同步。浏览器 PAT 只在当前页面内存中使用，刷新后重新授权；**桌面**选择记住设备时使用 Windows 凭证管理器，这两种授权方式不同。断开连接保留本机数据。完整 JSON 备份包含原事件、FSRS 状态与删除证据；CSV 不能无损代替完整备份。

本机备份 LocalBackup v2 与远端 `polar-vocab-state` 协议版本独立。新客户端可读旧协议 1，结构化义项、原词形和带译文上下文需要协议 2；不可将扩展伪装成旧协议。单快照上限 900,000 UTF-8 字节，720,000 起预警，不截断历史。

## 文件和资料

| 位置 | 内容 |
| --- | --- |
| `src/`、`public/` | Web 应用、页面、资源和本地数据服务 |
| `apps/desktop/` | 桌面主进程、原生辅助程序、界面与桌面测试 |
| `packages/shared/` | 采集协议、结构化义项与共享校验组件 |
| `tests/`、`scripts/` | Web 单元/E2E 测试与开发检查工具 |
| [docs/](docs/README.md) | 需求、架构、协议、开发与使用说明 |
| [reports/](reports/README.md) | 分阶段报告，整合报告位于 `reports/integrated/` |
| `artifacts/desktop/current/` | 日常使用的便携程序，不提交 Git |
| `artifacts/desktop/history/` | 历史版本、旧测试目录与可恢复归档，不提交 Git |
| `artifacts/desktop/build-output/` | 下次打包的可重建中间产物，不提交 Git |
| `.cache/`、`reports/test-results/` | 忽略提交的本地证据与独立自动测试输出，不能相互混放 |
| `node_modules/`、`dist/`、`apps/desktop/build/` | 忽略提交的依赖与构建文件 |

[完整规划书](docs/PROJECT_PLAN.md) 保留原件内容。[架构](docs/ARCHITECTURE.md) · [数据模型](docs/DATA_MODEL.md) · [同步设计](docs/SYNC_DESIGN.md) · [开发与部署](docs/DEVELOPMENT.md) · [GitHub 设置](docs/GITHUB_SETUP.md)

## 发布与历史边界

公开代码仓库为 [Polar0216/polar-vocab](https://github.com/Polar0216/polar-vocab)，正式站为 [Polar Vocab](https://polar0216.github.io/polar-vocab/)。唯一真实验收私库为 `Polar0216/polar-vocab-data-test`，只使用人工数据；公开仓库不得包含凭证、私人词库、复习数据或本地配置。

GitHub Actions 负责类型、lint、单元、构建、安全检查及 Pages 发布。生产默认子路径 `/polar-vocab/`，Hash 路由、manifest 与 SW 作用域保持一致；自定义根站使用公开的 `PAGES_BASE_PATH=/`。本轮获得普通 main 推送和 Web 部署授权，不允许 force push，不自动上传 exe 或创建 Release；实际发布结果记录在整合报告。

Phase 3.5 真实 401、iPhone 同步、正常跨版本 PWA 更新，以及 Phase 4 真实私库全链路，原未测项继续按历史报告标记；不能用本轮模拟授权测试追记为真实通过。旧报告是当时的记录，后续版本以整合报告为当前入口。

[Phase 3.5 报告](reports/phase-3.5/PHASE3_5_REPORT.md) · [Phase 4 报告](reports/phase-4/PHASE4_REPORT.md) · [0.4.1 性能报告](reports/phase-4/HOTKEY_PERFORMANCE_FIX_2026-10-26.md) · [0.5.0 词典报告](reports/phase-4.1/PHASE4_1_REPORT.md)

历史报告磁盘原件不改写。Git clean-only filter 只脱敏待公开 blob；过滤器本地配置不会随克隆传递，新增提交仍须配置并运行 `npm run check:public-index`。项目源码暂为 `UNLICENSED`，第三方及词典内容按各自许可保留声明。
