# Phase 3.5：首次部署与真实同步验收进度报告

检查日期：2026-10-15（Asia/Shanghai）。首次推送前报告经用户阅读并明确批准后，已继续普通首次push；**Phase3.5尚未整体完成**。首次Pages配置失败后用户修正Source并重跑，反馈attempt2 Success，正式站由工具独立验收通过。私库A–E真实通过；F/G局部不变量通过，旧版五轮整库同步暴露删除修订不收敛。当前修复专项20/20、完整17文件227测试及构建检查通过，隔离目录后的E2E为31通过/3跳过；尚未提交/部署，F/G正式站完整复验未验证，H未执行。iPhone1–3、6、8为用户通过反馈，第4项部分通过，其余待测。Dexie v3/17表、LocalBackup v2、GitHub协议v1不变，没有清库或进入Phase4。

状态用语：本地测试通过、模拟 API 测试通过、真实远端测试通过、iPhone 真机测试通过、尚未验证。前两项不能替代后三项。

## 1. 当前 Git 仓库状态

初始工作区没有 `.git`，依据明确授权初始化本地Git，主分支为main。首次提交SHA为 `9b138265ebf1d6ab8868e6d0f80e6193bcc4c268`，信息为 `Initial release: Polar Vocab Phase 0-3`；推送前141个实际文件与发布清单一致、工作区干净且仅有根提交。未执行reset、清库、force push、历史覆盖或删除受跟踪原件。当前本地修复包括删除合并逻辑、两项回归和Playwright输出目录隔离，相关检查已通过但尚未提交/部署，正式站需修复后复验。没有依赖升级、协议或数据库迁移。一次E2E误清理仅影响忽略的临时验收产物，已重导出两端数据，详见第11–12节。

仓库本地作者为 `Polar0216`，邮箱使用 GitHub 数字账号对应的 `242565556+Polar0216@users.noreply.github.com`。未将原全局私人邮箱写入提交，也未改全局 Git 配置。仓库本地配置 `core.autocrlf=false`，以现有文件字节为准。

完整待公开路径见 [RELEASE_FILES.txt](RELEASE_FILES.txt)。项目源码、资源与配置在工程目录；技术资料在 `docs/`；手写报告在 `reports/phase-*/`。自动浏览器报告不提交。

## 2. Git 远程配置

`origin` 为 `https://github.com/Polar0216/polar-vocab.git`，fetch/push 使用同一地址。没有新增或改名其他远端，也没有接触其他仓库。

首次推送前最后一次匿名 `git ls-remote --symref https://github.com/Polar0216/polar-vocab.git` 成功且无 refs，确认没有意外新增历史。普通推送后再次匿名核查 `refs/heads/main`，远端 SHA 与首次本地提交完整一致，当时本地为 `main...origin/main`。当前新增的修复和报告仍在本地，不将首次推送后的干净状态当成当前工作区状态。

本机存在 Git Credential Manager；没有 GitHub CLI。普通 Git 推送认证实际成功，没有读取或打印凭证存储，也没有在聊天索取密码/PAT。Git 写入认证成功不等于取得 Actions API 管理会话；不提取 Credential Manager 中的凭证去调用 API。

## 3. 公开仓库首次推送结果

**真实远端首次推送通过。** 用户明确批准后，再次审查实际提交、脱敏副本、独立克隆、清单与空远端，执行：

```sh
git push -u origin main
```

目标仅为 [Polar0216/polar-vocab](https://github.com/Polar0216/polar-vocab)。命令退出0，输出 `main -> main` 新分支及跟踪建立。远端提交：[9b138265](https://github.com/Polar0216/polar-vocab/commit/9b138265ebf1d6ab8868e6d0f80e6193bcc4c268)。未使用 force，也未覆盖任何既有远端历史。

## 4. GitHub Pages 部署状态和地址

正式站点：[https://polar0216.github.io/polar-vocab/](https://polar0216.github.io/polar-vocab/)。首次检查404；用户修正 Source 并重跑后，实际匿名 HTTP 为 **200**，标题和 `/polar-vocab/` 资源正确，独立 Edge 真实访问该HTTPS来源的18项UI检查全部通过，耗时约2分钟。**正式站已上线**，这不是本地 preview。

真实站覆盖桌面/手机尺寸下的五页导航及刷新、浅深主题/320px、英德词条编辑筛选与持久化、CSV预览/补充与离线XLSX、剪贴板拒绝回退、JSON备份/保护清空/恢复、四级FSRS/重复点击/配额/到期/离线评分、两标签原子评分。所有数据是独立浏览器环境内的人工词条，不使用PAT，不接入私有仓库。已有3个写死本地预览来源的用例不放入这次正式站测试选择；未删除原测试，本地完整回归已执行。

另对正式来源单独实测：manifest start_url/scope为 `/polar-vocab/`、实际SW脚本为正式 `sw.js`、scope为正式站子路径、Cache Storage中25个请求均为该来源静态资产且无Authorization/私库state文件；TXT导入、离线刷新和导航通过。HTTPS安全上下文与clipboard.readText能力存在；工具没有读取系统剪贴板或验证真实系统权限许可。用户另反馈 iPhone 导航、安装、独立应用布局及剪贴板导入正常，具体覆盖范围见第9节。

首次发布版本的本地 `build:pages`、产物检查与Edge E2E已通过：Vite base `/polar-vocab/`、HashRouter刷新、相对资产、manifest及SW作用域一致。SW只缓存静态资产，不缓存GitHub API，更新由用户确认。CSP `connect-src` 允许self与api.github.com，实际CORS另有私库A–E证据。当前删除收敛修复后的本地Pages构建、产物检查及E2E也已通过；正式站尚未更新，线上完整收敛仍待验证。

Clipboard API 的生产可用性仍受用户操作和 Safari 权限影响，保留手动粘贴入口。正式站 Edge 的能力检查和模拟拒绝回退通过；iPhone 导入正常来自用户反馈，不能据此推定拒绝回退、重复计数或离线功能通过。

首次部署在 Configure Pages 返回404，提示检查 Pages 是否启用及Source。用户随后明确反馈已在 [仓库 Pages 设置](https://github.com/Polar0216/polar-vocab/settings/pages) → **Build and deployment → Source → GitHub Actions** 完成设置，并点击原运行 Re-run jobs → Re-run failed jobs。此设置与重跑操作来自用户反馈，站点200及18项UI/SW结果由独立工具真实验证；未扩大工作流权限或引入私人PAT。

## 5. GitHub Actions 构建记录

真实运行：[38687892583](https://github.com/Polar0216/polar-vocab/actions/runs/38687892583)，对应首次 main 推送。公开运行页面显示首次 attempt 为 Failure；[deploy 作业](https://github.com/Polar0216/polar-vocab/actions/runs/38687892583/job/116267557622) 的 Configure Pages 注释明确报告404，Deploy 被跳过。[build 作业](https://github.com/Polar0216/polar-vocab/actions/runs/38687892583/job/116266851451) 的独立步骤结果还在核对，不将整体 Failure 当作某项测试失败，也不虚构详细 CI 测试数量。用户修正 Pages Source 后反馈 [attempt 2](https://github.com/Polar0216/polar-vocab/actions/runs/38687892583/attempts/2) 为 **Success（绿色）**；这是用户读取网页的反馈，未冒充工具读取日志。

已检查现有 `.github/workflows/deploy.yml`，保留整体工作流，仅补充必要发布保护：

- PR 验证，不上传/发布 Pages artifact；只有 main 的非 PR 运行可上传和部署。
- 保留正在运行的 main 部署，陈旧 PR 检查可取消，同分支部署串行。
- Node 24、`npm ci`、锁文件、类型/lint/单元测试/构建/产物/凭证/公开索引检查，以及 CI Chromium E2E。
- 构建只有 `contents: read`；部署 job 只有 `pages: write`、`id-token: write`。使用官方 Pages artifact / configure / deploy Actions 和 `github-pages` environment，仅上传 `dist/`。
- 官方 Actions 使用完整 commit SHA，已只读核对；保留既有有效 setup-node 固定 SHA，没有因版本标签变化无理由升级。checkout 不保留 Git 写入凭证。
- 不需要私人 PAT，不读取私有测试仓库，不把词库或 Token 注入公开构建。

Linux GitHub runner 的详细步骤尚未读取；整体重跑成功来自用户反馈，部署站点则有独立工具实测。本地 Edge 回归不能代替 Linux Chromium 的执行结果。匿名 Actions REST 返回403，已通过公开网页获得初次运行与失败注释；不为读取日志索取私人 Token。

## 6. 私有测试数据仓库连接状态

唯一目标为 `Polar0216/polar-vocab-data-test` / `main` / `data/state.json`。用户反馈只读预检成功，具体摘要为 main、本机0词/0评分、云端只有 README 且没有 state 文件、全部为人工测试数据，并明确授权仅此仓库初始化及验收。用户在两个独立 Edge profile 中自行输入受限 PAT，未在聊天提供凭证。

随后工具读到 A/B 均显示已同步、本机0词/0评分、pending=0、共同文件 SHA `33f8ff816354c2dd714137c901b39cdc4bc050df`，证明两端已建立连接及共同空库基线；连接目标精确匹配且 deviceId 不同。初始化操作在人工交互期间完成，未抓取其 PUT 响应，不能称为自动化记录了创建状态码。

后续新增人工EN词时两次同步显示「网络请求未确认，请联网后重试」，当时A保留1词/1pending、B仍0词；无凭证API同期也连接中断。用户在页面重新授权并保存连接前备份后，从原批次恢复，完成A–E。随后完整E2E旧输出目录清理误删了临时控制脚本、4份原始JSON备份和acceptance JSONL；打开的两端库及私库未丢失，已各重导出一份完整备份至忽略的 `.cache/phase3.5-real-sync/`。重新核对两端均5词/2卡/4评分/1墓碑/1决议、pending=0，B保留3份审计。旧原始产物不再完整保留，但已观察的工具结果如实记录。没有清库、重复建词或重新初始化远端；当前候选补丁待发布复验，不再归因于早期网络阻塞。

沿用既有客户端与内存凭证，用户在可信的正式网站设置界面手动输入只限此仓库、Contents 读写的 Fine-grained PAT。先只读测试、核对 Private/分支/快照、保存备份并确认，才能创建首个测试快照。已有数据不能自动覆盖。详见 [GITHUB_SETUP](../../docs/GITHUB_SETUP.md)。

## 7. 真实 GitHub API 测试结果

公开仓库页面、Git refs、站点 HTTP、两端私库共同基线及后续 A–E 真实读取/更新已验证。此前匿名 REST 曾返回403，随后浏览器 API 连接中断；之后无凭证公开 API 恢复 HTTP200，用户在页面重新授权后原批次也恢复。匿名结果与受限 PAT 的实际同步证据分别记录；没有从匿名成功推定私库通过。

| 验收项 | 本次状态 |
| --- | --- |
| GitHub 形状的 GET/PUT/SHA/ETag、错误、网络与限流 | 模拟 API 测试通过 |
| 正式站浏览器只读CORS与受限PAT认证 | 用户自行输入凭证；工具已核对共同基线及 A–E 实际读取/更新结果，未读取凭证或抓取初次PUT状态码 |
| Private 检查、可访问分支 | 用户反馈 main、本机0/0、云端无state仅README；两端连接目标由工具精确核对 |
| 无文件与无权限区分 | 模拟通过；用户确认初始缺文件，随后两端已读到相同空库SHA；未记录初次404响应 |
| 真实 GET、PUT 创建/更新、SHA 与 ETag | A–E 的读取/更新及文件SHA已核对；初次创建状态码未抓取，ETag/条件命中头尚未独立验证；F/G完整收敛失败单列第8节 |
| 页面重新授权及原批次恢复 | 早期两次网络失败后已真实恢复，记录和pending未丢失；不替代实际撤销凭证或H全部场景 |
| 真实 Token 撤销/401 后重授权 | 尚未执行；现有模拟覆盖不能替代真实结果 |
| 真实 API 限流恢复 | 尚未触发，不能标为通过 |

保留客户端安全边界：固定 GitHub API 来源，禁止重定向、Cookie 与缓存，错误信息不输出凭证，容量预算与 SHA 比较不变。

## 8. 双设备同步与冲突测试结果

| 项目 | 本地与模拟证据 | 真实远端状态 |
| --- | --- | --- |
| A 英德词条新增 | 独立数据库与浏览器模拟通过 | 真实远端通过：A/B双向新增后2词，UUID/语言/内容/SHA一致，pending=0 |
| B FSRS / ReviewEvent / due | 实际 ts-fsrs 与同步模拟通过 | 真实远端通过：一条Good原始事件、完整卡片与due两端一致 |
| C 离线不同新增 | 合并、pending 与恢复模拟通过 | 真实远端通过：A离线新增和B在线不同新增均保留，恢复后两端一致 |
| D 独立字段合并 | 三方合并模拟通过 | 真实远端通过：释义与标签独立修改均保留并收敛 |
| E 同字段冲突 | 三方副本、人工决议与审计模拟通过 | 真实远端通过：基线/本机/远端副本与审计保留，采用远端后两端收敛 |
| F 删除/编辑 | 原测试检查墓碑/审计；新增回归修复前复现失败、修复后专项20/20 | 部分通过：删除标记、墓碑和审计保留；旧版五轮整库未收敛，补丁正式站完整复验尚未验证 |
| G Good/Again 分叉 | 两独立浏览器、决议传播及后继评分模拟通过 | 部分通过：不同原始事件同父状态、冲突卡不调度、Again决议传播；等真实due后Good父引用与卡片/事件/决议一致，但完整集合受F删除修订缺陷影响，整体未通过 |
| H 幂等/失败恢复/并发 | 上传时新增/评分、响应丢失、ACK 故障、重启与租约模拟通过 | 尚未执行，不将早期网络恢复当成H全部通过 |

G 的实际到期时刻为07:33:21 UTC，后继 Good 于07:34 UTC 实际评分，已核对 `parentResolutionId`、`parentStateId`、`parentReviewEventId`，没有改时钟强制评分。随后完整集合复核发现同一删除词条在两端保留旧删除修订与显式保留删除决议的新修订，五轮同步仍未收敛且远端 SHA 往复变化。复习链正确不等于整库收敛通过。根因、回归和当前修复状态见第12节。

此前Phase3浏览器API由本机假GitHub拦截，不替代真实私库。本次另用两个独立Edge profile、用户在页面手动输入的受限凭证，唯一目标固定为测试私库，逐项填写实际结果。临时脚本、早期备份和JSONL后来被E2E旧输出目录误清理，不能声称这些原始文件仍完整留存；两端数据已重导出，当前恢复备份和元数据在忽略的 `.cache/phase3.5-real-sync/`，不公开。具体步骤见[REAL_DEVICE_CHECKLIST](../../docs/REAL_DEVICE_CHECKLIST.md)。

## 9. iPhone 真机测试状态

用户反馈iOS **26.6** 第1–3项通过：Safari五页导航、添加到主屏幕、独立应用布局/按钮/无横向滚动；随后反馈剪贴板导入正常。对明确询问的「在线EN保存后刷新」和「飞行模式编辑保存后刷新」组合问题，又明确反馈「通过」，因此第6、8项对应行为记用户报告通过。以上均非工具独立真机观察。

第4项单次导入数量/去重仍未明确核对，仅部分通过；第5项拒绝回退、第7项德语结构字段及第9–14项仍未验证，包括离线FSRS、重开、重新授权、跨设备同步、分叉及跨版本更新。离线编辑刷新通过不等于离线复习通过，第8项的离线/待同步提示也未单独核对。不能将「通过」扩展到未询问的项目。

Edge 手机尺寸是 Chromium 模拟，不等于 iOS。首次发布不能证明跨版本 SW 更新；后续有获批准的新版本时再验证。反馈步骤见 [真机清单](../../docs/REAL_DEVICE_CHECKLIST.md)，不反馈 Token、请求头或个人备份。

## 10. 数据安全与 Token 检查结果

首次公开前，公开树、当时构建和实际Git索引分别检查，未发现常见GitHub PAT/私钥或私人学习数据。当前补丁的 `npm run check:secrets` 随check通过；提交前仍须复查实际索引和最终变更。早期4份JSON备份曾通过私人产物模式检查，之后被误清理；当前两份重导出备份为新文件，最新独立产物检查尚待执行，不能沿用旧文件结果。测试仅用人工数据，模式扫描不保证识别全部私人内容。

`.gitignore` 补齐本机代理目录、凭证/密钥、数据库、浏览器 profile 和临时产物；`node_modules/`、`dist/`、`.env*`（仅公开 `.env.example` 例外）、数据/备份、截图/trace/HTML 测试报告均不公开。

原 Phase 1/2/3 报告含本机账号路径，为保留原件采用 **Git clean-only filter**：磁盘原件不改；送入索引的公开版本把项目绝对路径替为 `<project-root>`。已验证过滤幂等、原件字节保留；没有 smudge 私人路径。旧规划和所有历史报告原件的 SHA-256 与公开版本摘要见 [HISTORICAL_REPORTS.json](HISTORICAL_REPORTS.json)。公开索引检查同时拒绝本机账号路径和常见私人邮箱；提交作者使用 noreply。

获准推送前再次按 HEAD 实际 blob 核对6个原件/公开 SHA-256、3份脱敏报告、作者邮箱、根提交历史和141文件清单，全通过。另在系统临时目录实际 `git clone --no-hardlinks`，不继承 filter 本地配置，运行公开索引检查仍通过且 checkout 干净：新克隆不会重新出现旧私人路径。

**未来克隆的限制：** `.gitattributes` 随 Git 分发，但 filter.clean 和 required 的仓库本地配置不分发。新克隆既有内容安全；将来新增含私人路径的报告仍可能未经处理进入 Git，所以提交前必须重新配置 filter 并运行 check:public-index、人工审查。CI 在 push 后运行，无法阻止首次泄漏；当前规则也不保证识别所有私人内容。不会将 clean filter 当作完整安全边界。

Token内存、备份不含凭证、断开不清库、恢复撤销旧SHA、SW不缓存API及无授权日志有原模拟验收。正式站缓存无API已独立验证，真实云端完整内容安全尚未独立检查。用户自行在浏览器输入PAT，控制不读取凭证输入/请求头/完整响应或完整DOM，不生成凭证截图/trace，不显式写入Token。旧产物误清理没有造成PAT暴露、受跟踪原件或数据仓库丢失；当前重导出备份、元数据及profile均不发布。

## 11. 实际执行的测试命令和结果

环境：Windows、Node 24.13.0 / npm 11.6.2 / Git 2.53.0.windows.1。依赖版本没有改变；`npm ls --depth=0` 成功，package/lock/已安装直接依赖一致。锁文件 version 3、604 个 package 条目，resolved 包使用 npm 官方 registry、完整性字段存在，无带凭证下载地址。

首次发布版本的225项单元、18项正式站UI和SW检查是历史已执行基线。当前补丁另实际执行了专项20/20、完整227项检查及新的本地E2E31通过/3跳过；以下分别注明，不把旧结果当成新执行，也不把本地绿当成已部署。首次误清理导致中止的E2E单独记失败，不隐藏为通过。

| 命令 | 实际结果与适用范围 |
| --- | --- |
| `npm run typecheck` | 当前补丁随check通过；输出目录配置更改后另单独重跑，退出0 |
| `npm run lint` | 当前补丁随check通过；输出目录配置更改后另单独重跑，退出0；单文件lint亦通过 |
| `npm test` | 首次发布17文件/225通过；当前check实际17文件/227通过，含两项新增删除回归 |
| `npm run check` | 当前补丁退出0：类型、lint、227项单元、Pages构建、产物及凭证检查全部通过 |
| `npm run build:pages` | 当前补丁随check通过，默认 `/polar-vocab/` |
| `npm run check:dist` | 当前补丁随check通过，子路径/manifest/SW/CSP/静态外壳有效 |
| `npm run check:secrets` | 当前补丁随check通过，源及构建无识别的凭证或私人数据目录；不替代新重导出备份检查 |
| `npm run check:public-index` | 首次发布实际索引通过；当前补丁尚未提交，最终暂存内容待重新审查 |
| `npm audit`、`npm audit --json` | 两次在线审计均成功，0 个已知漏洞；不是对未来漏洞的保证 |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e`（首次修复后尝试） | 旧输出目录清理误删临时验收文件，主动停止、退出1；该轮未通过 |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e`（输出目录隔离后） | 新一轮实际退出0：31 passed / 3 skipped / 34总项，约1.1分钟；此前首次发布也有独立31/3基线 |
| `npx playwright test --config reports/test-results/live.config.mjs`（此前正式站） | 当时18项正式HTTPS UI通过，约2分钟；临时配置/原始产物后来误清理，观察到的工具结果保留为报告证据 |
| `node reports/test-results/live-shell.mjs`（此前正式站） | 当时manifest/SW作用域、25静态缓存、TXT、离线刷新导航通过；临时脚本/原始产物后来误清理 |
| `node reports/test-results/real-sync-harness.mjs`（此前启动） | A–E真实通过，F/G局部不变量通过但五轮整库收敛失败；旧脚本/早期备份/JSONL误清理后，仍打开的A/B库已重导出，H未执行 |
| `npx vitest run tests/unit/sync/engine.test.ts`（修复前新增回归） | 实际18 passed / 1 failed，复现显式删除决议后远端回退旧修订 |
| `npx vitest run tests/unit/sync/engine.test.ts`（修复后） | 实际20/20通过，含两项新增完整删除收敛/并发删除回归 |
| `git diff --cached --check` | 额外格式检查有提示：既有 CRLF 被默认规则当作尾随空白；识别 CRLF 后仅剩原规划两份各 4 行 Markdown 双空格换行及旧 UI 测试末尾空行，保留原件，不标为全树通过 |
| 历史原件哈希、过滤幂等、公开文件/文档链接检查 | 本地通过；原件未改 |

3 个 E2E 跳过项是手机项目中重复的进程重启场景；对应桌面场景全部执行通过，没有删除测试。浏览器测试按现有 Edge 通道执行，没有重复下载浏览器。受限环境下本机服务器/浏览器与匿名网络读取在允许后执行，结果为真实本地执行结果。

补充格式核对实际执行 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check`，退出 2，仅有上述 9 条旧格式提示。它不是功能测试失败；未为消除提示改写规划书、历史报告或降低现有测试约束。

首次发布构建主入口约406.03kB（gzip126.58kB）、Dexie95.20kB（gzip31.30kB）、设置67.33kB（gzip20.72kB）、CSS42.23kB（gzip9.11kB）；当时SW预缓存28项约793.91KiB。这些是首次发布体积，不冒充补丁精确体积；补丁新构建已通过，未修改CSS或提高警告阈值。CI Linux详细步骤、真实站性能及真机性能尚未验证。

## 12. 已修复的问题

本次发布准备修复：公开文件排除规则不足、历史报告包含本机路径、Git 作者可能暴露私人邮箱、main 部署被新运行中断的风险、非 main 手动运行无须上传 Pages 产物，以及缺少真实设备和首次发布检查记录。

上述发布保护涉及 `.gitignore`、报告过滤器及 `.gitattributes`、公开索引检查脚本和 npm 命令、现有工作流的小幅保护改动、文档与发布报告。

**已本地修复、待上线复验：删除修订不收敛。** `mergeRecord`双侧已删除分支原先先选本机删除副本，跳过修订祖先关系。`keep-deleted`决议生成同时包含旧删除/编辑修订为父的新修订，但旧设备仍选旧删除；两端反复上传各自副本，SHA往复。真实五轮复现后，新增回归修复前实际18通过/1失败，直接验证远端回退旧删除修订，不能只依赖墓碑存在的旧测试。

本地 `src/features/sync/merge.ts`现先选择明确后继祖先，再处理共同基线；等正文无祖先关系时固定选择修订，不同正文则保留副本并产生可审计删除冲突。两项新回归要求完整逻辑快照、墓碑、审计、重复同步后的SHA/PUT次数稳定。专项20/20、完整227项检查/构建和新的31/3本地E2E已通过。**尚未提交/部署，F/G真实修复后完整复验仍未验证，不能称为已上线修复。** 无协议/依赖/数据库变化，不清库、不丢弃墓碑或评分。

**已修正的验收操作问题：E2E输出清理范围。** 首次完整重跑沿用 `reports/test-results/`，启动清理误删临时控制脚本、4份原始JSON备份及acceptance JSONL；已停止该轮并记退出1，没有隐藏成通过。打开的两端人工库已重导出为 `.cache/phase3.5-real-sync/` 中两份恢复JSON，另存恢复元数据；核对每端5词/2卡/4事件/1墓碑/1决议、pending=0，B的3份审计保留。没有受跟踪原件、PAT或私库数据丢失。旧临时原始文件并非全部恢复；此前观察到的工具结果仍是报告证据。`playwright.config.ts`已将输出隔离为 `reports/test-results/e2e/`，恢复备份位于该清理范围之外，新一轮E2E已实际通过。

Phase 3.5 原任务第9项要求修复真实验收发现的问题并重新测试/部署；在首次公开推送已获批准后，这项必要修复及常规验证属于现有授权，不需要额外批准。仍不允许 force push、手动覆盖私人远端文件或进入 Phase 4。

## 13. 尚未验证的功能和原因

- 普通首次 push、Git 写入认证和远端 main SHA 已真实验证；不是未验证项。
- Pages 首次配置失败后，用户设置Source并重跑，明确反馈 attempt 2 为 Success；正式站200及18项UI/SW/离线由工具独立验证。详细Actions日志仍因网络连接中断未读取，不用站点结果冒充日志。
- Actions Linux 详细步骤还在核对；没有将本地测试结果冒充远端日志。
- 测试私库已连接，早期网络失败后重新授权并从原批次恢复，A–E真实验收通过；初次PUT响应状态码未记录，ETag及条件命中头尚未独立验证，不通过聊天取得PAT。
- F/G旧版五轮整库收敛失败。本地修复专项20/20、完整227项及新E2E31/3已通过，但提交/部署及正式站原数据完整复验尚未完成。
- H 幂等、上传期间收词/评分精确ACK、离线刷新、同profile标签锁及真实撤销凭证尚未执行。已有网络恢复不代表H整体通过；主动异常优先模拟，不破坏测试仓库。
- 真实限流、容量极限和低性能设备压力：未触发或未测，保留现有预算和提示，不伪造通过。
- iPhone第1–3、6、8项为用户报告通过，第4项导入正常但计数未确认；第5、7、9–14项、存储驱逐及发布更新仍未验证。没有将离线编辑通过扩展成离线FSRS通过。
- 旧临时脚本/4份原始JSON/JSONL被E2E误清理，不能提供其完整原始文件；已从打开的两端重导出两份恢复JSON，最新备份独立产物检查尚待执行。未清库或损坏私库。

## 14. 是否具备进入 Phase 4 的条件

**当前不具备完整验收条件，不进入Phase4。** 首次发布及A–E真实通过；删除收敛候选补丁已完成专项20/20、完整227项和本地E2E31/3验证，尚待最终公开索引审查、普通提交/部署及F/G正式站完整复验，再继续H与剩余iPhone清单。输出目录误清理的失败轮次及旧产物缺失如实记录，恢复数据已重新导出；不把本地绿或新备份等同于线上通过/全部旧产物恢复。只用人工数据和既有目标，分别标注用户反馈与工具验证。

后续验证顺序见 [DEVELOPMENT](../../docs/DEVELOPMENT.md)，在既有授权内续测无需重复批准。手动覆盖/删除远端文件、非测试私库写入、降低保护及其他仓库操作不在现有授权内。
