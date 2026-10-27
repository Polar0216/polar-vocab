# 0.6.1 目录整理与真实私库验收

日期：2026-10-27。本文补充[整合发布报告](INTEGRATED_RELEASE_REPORT.md)和[授权修复报告](AUTH_WINDOW_FIX_0_6_1.md)，是当前状态入口。历史报告的当时结论保留。

**目录整理、便携启动、真实私库v1/v2后台链路已验证；完整跨应用划词实机验收仍未完成。**最后一段工作按用户要求只在后台执行，没有切换窗口、桌面输入或启动可见测试窗。iOS继续跳过。

## 日常入口与目录整理

当前从外层“启动Capture收词.lnk”打开收词器，从“打开背词软件.url”打开[完整背词网站](https://polar0216.github.io/polar-vocab/)。快捷方式目标为 `project/artifacts/desktop/current/Polar-Vocab-Capture-0.6.1-win-x64.exe`，无隔离参数；原桌面入口已收回。当前exe为100607766字节，SHA256 `3d0730e2a535ecbaff1ff09d90fc415e4e54f4ae8aff3fbb32d4607bda1d1229`；整理前后字节一致，没有换成新的未经验证版本。

**18时后用户追加要求的外层整理结果：**整个仓库（含.git、node_modules、源码、报告、程序和.cache）完整收进外层 `project/`，29个原顶层项目均完整移动；工程内部与远端结构不变。最外层只有project、使用说明.md、启动Capture收词.lnk、打开背词软件.url。新快捷方式目标和空参数已读取核对，网站入口URL已核对；原桌面快捷方式移到history/shortcuts，不在桌面保留。本文其他无前缀路径均相对移动后的工程根目录。

从新路径再次真正启动普通0.6.1 SFX（这次未加调试参数），窗口版本正确、快捷键注册成功，设置显示已自动恢复并验证正式私库授权，未再次输入PAT；数据目录不变，exe SHA仍一致。SFX启动器本身没有窗口，首次工具报告未暴露窗口，重新枚举后实际解压子进程窗口可用，未将此记为软件启动失败。

| 位置 | 当前用途 |
| --- | --- |
| `artifacts/desktop/current/` | 日常0.6.1便携程序 |
| `artifacts/desktop/history/` | 0.4.0/0.4.1/0.5.0/0.6.0及原测试目录、可恢复归档 |
| `artifacts/desktop/build-output/` | 已配置为以后默认打包输出；下次构建才生成 |
| `docs/`、`reports/` | 技术文档、阶段报告，与源码分开 |
| `.cache/` | 原始备份、验收profile、故障证据，不提交Git |

重复Electron unpacked副本、builder调试/图标临时输出、早期0.6.1重复候选，以及锁文件修复临时目录内重复node_modules，先完整归档校验再删除。递归目标限定在工作区，拒绝reparse和数据库。详情见[文件夹指南](../../docs/FOLDER_GUIDE.md)。

| 清理核对 | 实际结果 |
| --- | --- |
| 归档 | `artifacts/desktop/history/cleanup-20261027-recoverable.zip` |
| 逐文件SHA256验证 | 24502个文件通过，原大小2742217264字节 |
| zip | 1266389852字节，SHA256 `9b109e2838e5f03336f2d44ca6c3555a1856772b3c78e6dad82eab9c51615113` |
| 首轮净释放 | 1375219646字节，已扣zip和日常版复制 |
| 再删除同哈希重复SFX | 100607766字节 |
| 最终净释放 | 1475827412字节，约1.37 GiB |
| 保护检查 | 1304个SQLite/db/WAL/SHM、历史phase报告及PROJECT_PLAN，按目录迁移映射后均存在且哈希一致 |

正式数据库仍在 `%APPDATA%/Polar Vocab/Capture/captures.sqlite`，metadata保存设置与目标；同级 `Capture.runtime` 是浏览器缓存。PAT仍在Windows凭证管理器。移动exe不移动数据库。正式库此后因人工验收正常新增事件，不能把清理时哈希一致理解为此后未写入。

旧程序、测试词库、SQLite队列/备份、浏览器profile、故障资料及所有历史报告保留，没有删除私库文件或复习记录，没有Git reset/clean/force。恢复zip应解压到新空目录，不得直接覆盖活跃数据库。新的builder默认输出只放可重建中间产物，避免再次混入日常目录；不改变当前exe。

## 授权恢复与真实目标

用户本人在0.6.1原生授权窗确认连接且勾选记住，随后明确授权 `Polar0216/polar-vocab-data / main` 也全是人工数据，可执行验收。本次不再受历史data-test目标限定，也没有操作其他私库。

观察到应用显示已连接、已记住，但独立进程读取标准AppData SQLite的目标为空。安全凭证存在且真实GET成功。另一个打包宿主候选目录也已核查，**尚不能证明MSIX虚拟化或某一唯一根因**。先在线备份SQLite（包含WAL），仅在目标缺失、凭证绑定目标相符且GET核验成功时补回目标metadata；设备ID、事件及批次逐项不变，不改凭证或重建队列。

修复后正式SFX正常退出、重启0.6.1，未再输入PAT，实际状态为正确目标、connected=true、remembered=true、自动上传false，真实GitHub核验成功。该重启发生在用户后来禁止桌面操作之前。当前进程新增的3条事件也已由独立只读Node进程从标准SQLite完整读回并在线备份。

这证明**目标metadata修复后的这次自动恢复**成功，不代表此前每次确认均正确落盘。最初差异和不同启动宿主的长期一致性仍需观察。设置输入框重进页面可能显示默认测试仓库，实际连接看顶部目标；本次后台始终核对正式目标及自动上传关闭，不会自动改目标。

## 真实私库端到端

初始真实GET备份：0词/0卡/0评分/0采集/0批次，远端已有有效state.json，未初始化、清空或回滚。通过正式Web正常导入人工基线词、建卡并Good评分一次，建立非空FSRS基线。CSV导入本身也产生1条采集事件与回执。

正式网页运行在**headless Edge独立profile**，serviceWorkers=block，不操作用户浏览器。验收器在本机Node内存中读Windows安全凭证，仅为固定私库请求注入凭证并转发至真实GitHub；浏览器只拿人工占位串。无FakeGitHub/模拟HTTP，无真实PAT进入renderer、日志、截图、命令行、环境变量或文件。这是临时本机验收工具，不是新增产品服务器，也不是常规Web手填PAT流程的重测。

| 实际步骤 | 结果 |
| --- | --- |
| Web只读预检、连接前完整备份、确认同步 | 真实GitHub GET及带SHA的快照PUT成功 |
| v1旧格式事件 | 现有桌面严格save IPC保存、SQLite持久化、create-only上传、正式Web预览接收通过 |
| EN v2 | WiktApi明确persevered→persevere；2义项、独立中文翻译、首义项人工编辑、真实整句译文保存 |
| DE v2 | WiktApi明确Häuser→Haus；4义项、das/Häuser来源、独立中文翻译、人工编辑、真实句译保存 |
| 本机队列与批次 | 3条桌面事件，2个冻结批次，全部acknowledged；自动上传始终false |
| 真实批次回下载 | 协议分别1和2；全部3条事件与SQLite canonical逐字段一致，旧v1路径及SHA不变 |
| 桌面上传边界 | v2上传前后state SHA同为 `8e3a0a6b6e4cea1ffe3d659dbe8c4890a70d3ee9`，只新增captures批次 |
| 正式Web接收 | 4词/1卡/1评分/4事件/4回执；原词形、原型证明、义项、德语字段、上下文译文和来源逐字段保留 |
| 重复收藏/接收 | 同ID同内容save返回同ID；再次预览显示已接收且确认禁用，重复同步不改state SHA、不新增批次 |
| 修改后再同步 | Web编辑persevere首中文义项，人工标记、稳定义项ID、原句/译文和词形证明保留，再接收不覆盖编辑 |
| FSRS保留 | 基线卡片、评分及冲突处理记录canonical逐项相同，未改算法或复习事件身份 |

最终真实回读：4词、1卡、1评分、4事件、4回执，3事件来自桌面，1来自Web的人工基线。state SHA `1f7bbd92128d318d14a271209be1a5af7f821ce9`；无待上传事件再次同步后回读仍为此SHA，批次仍2个。

基线与最终卡片SHA256均为 `51a3a574f7087546a31ab27f8951d8145526c3e7ea03dcd184a7370387c7cdbf`；评分均为 `1e7f84227e453801eccef51932cec50c1d5ae03c08db45eae1f6a954d7d81ff5`。初始没有用户非空学习历史，因此这里只证明人工非空基线保留，不冒称大量真实学习数据迁移验收。

EN/DE数据由后台生产Provider类取得，再经已运行桌面的save IPC保存；源字段明确标记背景服务/IPC夹具。没有向桌面输入文本或发送热键。**本项覆盖服务、数据、SQLite、真实GitHub和Web接收，不覆盖物理选区、快捷键或焦点。**

## 真实服务耗时及失败保留

| 人工场景 | 原词形 | 原型词典+中文候选 | 整句翻译 |
| --- | ---: | ---: | ---: |
| EN persevered/persevere | 2727ms | 2330ms，2义项/2中文 | 498ms，完整 |
| DE Häuser/Haus | 2985ms | 4391ms，4义项/4中文 | 629ms，完整 |

这是一次真实Node生产Provider网络耗时，不是热键/弹窗/UIA时间；不能声称200–300ms反馈或1秒取词已达标。先前Electron真实公共服务结果仍见整合报告。Provider仍为免费WiktApi/Wiktionary与独立MyMemory，许可、署名、配额和查询处理限制见[Provider说明](../../docs/DICTIONARY_PROVIDERS.md)。

最初v1真实接收已成功，但验收脚本漏算CSV基线产生的采集事件，事后数量断言失败。没有回滚或重建数据；保留失败截图和输出，修正为基线与桌面事件ID并集，恢复同一profile重新核对通过。后台Web最终重跑转发74个真实GitHub请求；结束后关闭专属无窗口context并清除凭证引用，用户Web会话、桌面窗口和自动上传设置不变。

## 自动化和发布

| 命令/证据 | 实际结果 |
| --- | --- |
| `npm run check` | TS（含Desktop）、ESLint、Web20文件246测试、Pages构建、子路径/PWA/离线壳、安全扫描全部通过 |
| `npm run test:desktop -- --exclude '**/credential-prompt.test.ts'` | 10文件73测试通过；会显示原生诊断窗的3项本轮明确排除 |
| 早先完整Desktop回归 | 11文件76测试、Electron E2E 7通过/2跳过；本轮未重新打开GUI测试，见授权修复报告 |
| 早先完整Web回归 | headless Edge 37通过/3既有移动重复进程项跳过，正式页面模拟GitHub接收6/6；与本次真实私库分开 |
| 后台真实验收脚本 | `real-web-runner-r3.cjs`、`background-v2.cjs`、`desktop-control.cjs events/sync`、`verify-real-final.cjs`实际通过，只留本机.cache |
| 既有公开发布 | 提交 `471bc9f728a88727f1f2a3cb6da2c0cf413ecceb` 的[Actions 40451751700](https://github.com/Polar0216/polar-vocab/actions/runs/40451751700) success；正式Web仍为兼容v1/v2的0.6.0 |

本次仅改分类、未来打包输出位置、说明和验收报告，不改当前exe、FSRS、事件身份或协议。实际索引、clean filter、新克隆及远端核对结果补记在末尾。

## 原始证据与未完成项

原始证据仅留 `.cache/cleanup-20261027/`、`.cache/integrated-live-20261027/`：归档与1304项保护检查，SQLite在线备份、metadata修复回执、便携重启状态、原始远端快照/批次SHA、Provider结果、Web失败与恢复记录。最终逐字段证明在 `final-proof-*`。队列、快照、浏览器profile和凭证不提交Git。

- 0.6.1真实记事本、浏览器选区、无选区、连续热键和焦点/性能尚未完成。用户正在做其他事且明确禁止桌面操作，本轮不补开可见程序。
- 真实PAT撤销401、iPhone同步、正常跨版本PWA更新未验证；本次阻止SW，不能算离线或跨版本更新实测。模拟失败回归不能替代。
- 初始目标metadata缺失的根因和跨启动宿主长期一致性仍需观察；修复后的当次重启、真实授权恢复和独立进程SQLite读回已通过。
- Windows10、ARM、签名/SmartScreen未补测，仍为未签名Windows x64程序。旧版只用其历史数据目录，不能打开新版库。

可日常试用现有0.6.1，后台同步兼容验收已完成；不能将整合项目标记为“所有跨应用实机验收完成”。

## 本次公开内容审查

实际暂存索引231个源码/文档文件扫描通过，发布清单与索引一致；不含exe、SQLite、原始快照、profile、日志或识别到的凭证。仓库本地clean filter仍为 `node scripts/public-report-filter.mjs` 且required=true，只对历史phase报告的公开blob脱敏，不改变本机原件。10份相关Markdown的本地链接均有效，CRLF感知的diff空白检查通过。最终再次核对1304项保护文件，无缺失、无哈希变化。

既有正式发布的build/deploy作业均已公开API核对成功，线上HTML、release.json及入口5个JS/CSS资产与本地已测构建一致。此次改动不改变Web代码，报告提交使用 `[skip ci]`，不重复部署相同网站；后续新克隆与普通推送的实际结果继续补记。

本地提交79e908b已完成；原定独立克隆操作一度因自动审批额度用尽未执行，额度恢复后正常重试成功。实际新克隆不含原仓库的本地clean filter配置，源码/索引两次扫描231文件通过，工作区干净，证明公开内容脱敏不依赖重新克隆机器的filter设置。

用户随后允许屏幕验收但本人离开，需要本人完成的操作继续搁置。实际记事本和文件对话框未返回可确认编辑焦点，没有代输或修改其已有文档；Explorer启动访问许可超时，没有绕过。Edge人工测试页已打开，但Windows控制接口随后无法可靠确认浏览器当前URL而强制中止；已停止全部屏幕输入，没有换其他接口绕过，也没有真实热键计时样本。该项继续未验证，不能写成软件取词失败或性能达标。

整体移动后再次核对1304个受保护文件，全部存在且SHA一致；新入口存在、空启动参数、网站URL正确、旧桌面入口不存在，检查结果在 `.cache/outer-folder-20261027/`。只读SQLite仍为3事件/2批次、全部acknowledged、自动上传false；本轮人工文本页后台服务器已停止，测试资料保留。

搬迁后在新的project工程根目录再次运行 `npm run check` 全部通过（Web246测试、TS、Lint、Pages/PWA、安全扫描），无窗口Desktop单元73项再次通过。5份本轮改动Markdown的相对链接无失效。内部相对路径、既有构建资产名与运行时数据目录没有因外层收纳改变。
