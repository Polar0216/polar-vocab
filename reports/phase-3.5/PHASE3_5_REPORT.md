# Phase 3.5：首次公开推送前检查报告

检查日期：2026-10-15。此报告对应用户授权的步骤一、步骤二；停在首次公开 push 前，**Phase 3.5 尚未整体完成**。没有公开推送、部署或对私人仓库写入数据。原 Phase 0–3 功能、Dexie v3 / 17 张表、LocalBackup v2 及 GitHub 协议 v1 保持不变。

状态用语：本地测试通过、模拟 API 测试通过、真实远端测试通过、iPhone 真机测试通过、尚未验证。前两项不能替代后三项。

## 1. 当前 Git 仓库状态

初始工作区没有 `.git`，依据本次明确授权初始化本地 Git，主分支为 `main`。准备首次本地提交，信息为 `Initial release: Polar Vocab Phase 0-3`；交付时的提交 SHA 和干净状态以实际 `git log -1`、`git status --short --branch` 为准。未执行 reset、清库、force push、历史覆盖或删除原文件。

仓库本地作者为 `Polar0216`，邮箱使用 GitHub 数字账号对应的 `242565556+Polar0216@users.noreply.github.com`。未将原全局私人邮箱写入提交，也未改全局 Git 配置。仓库本地配置 `core.autocrlf=false`，以现有文件字节为准。

完整待公开路径见 [RELEASE_FILES.txt](RELEASE_FILES.txt)。项目源码、资源与配置在工程目录；技术资料在 `docs/`；手写报告在 `reports/phase-*/`。自动浏览器报告不提交。

## 2. Git 远程配置

`origin` 为 `https://github.com/Polar0216/polar-vocab.git`，fetch/push 使用同一地址。没有新增或改名其他远端，也没有接触其他仓库。

匿名读取公开仓库页面显示仓库为空；不使用凭证的 `git ls-remote --symref https://github.com/Polar0216/polar-vocab.git` 成功退出且无 refs。只证明检查时公开仓库无 Git 引用，不能证明本机拥有推送权限。首次推送获批后仍须再查一次远端，若出现历史先分析，不用 force。

本机存在 Git Credential Manager；没有 GitHub CLI。未读取或打印凭证存储，GitHub 写入身份尚未验证。未来若需要登录，使用 Credential Manager 浏览器流程，不能在聊天中收集密码或 PAT。

## 3. 公开仓库首次推送结果

**尚未推送，等待用户明确批准。** 本阶段仅准备本地候选提交和公开清单。拟执行普通推送：

```sh
git push -u origin main
```

目标仅为 [Polar0216/polar-vocab](https://github.com/Polar0216/polar-vocab)。批准前不运行该命令；不存在真实远端提交或首次 push 成功证据。

## 4. GitHub Pages 部署状态和地址

预期站点：[https://polar0216.github.io/polar-vocab/](https://polar0216.github.io/polar-vocab/)。当前实际匿名 HTTP 检查返回 **404**，尚未上线。

本地 `build:pages`、产物检查与 Edge E2E 已通过：Vite base `/polar-vocab/`、HashRouter 刷新、相对静态资源、manifest id/start_url/scope/icon、SW 注册与静态离线外壳。SW 只缓存静态资产，不缓存 GitHub API。更新采用 prompt，确认后才切换。CSP `connect-src` 允许 `self` 和 `https://api.github.com`，不代表真实 API CORS 已通过。

Clipboard API 的生产可用性还受 HTTPS、安全上下文、用户操作和 Safari 权限影响，保留手动粘贴入口；真实正式站和 iPhone 尚未测。不能用本地 preview 代替上线结论。

首次 push 获准后，打开 [仓库 Pages 设置](https://github.com/Polar0216/polar-vocab/settings/pages) → **Build and deployment → Source → GitHub Actions**。当前未操作此设置；若 GitHub 要求所有者确认，由用户完成，再运行/重跑 main 工作流。

## 5. GitHub Actions 构建记录

**真实 Actions 尚未运行，没有运行链接或成功记录。** 已检查现有 `.github/workflows/deploy.yml`，保留整体工作流，仅补充必要发布保护：

- PR 验证，不上传/发布 Pages artifact；只有 main 的非 PR 运行可上传和部署。
- 保留正在运行的 main 部署，陈旧 PR 检查可取消，同分支部署串行。
- Node 24、`npm ci`、锁文件、类型/lint/单元测试/构建/产物/凭证/公开索引检查，以及 CI Chromium E2E。
- 构建只有 `contents: read`；部署 job 只有 `pages: write`、`id-token: write`。使用官方 Pages artifact / configure / deploy Actions 和 `github-pages` environment，仅上传 `dist/`。
- 官方 Actions 使用完整 commit SHA，已只读核对；保留既有有效 setup-node 固定 SHA，没有因版本标签变化无理由升级。checkout 不保留 Git 写入凭证。
- 不需要私人 PAT，不读取私有测试仓库，不把词库或 Token 注入公开构建。

Linux GitHub runner 的实际安装、浏览器执行、环境规则与最终部署仍需首次推送后的 Actions 证据。

## 6. 私有测试数据仓库连接状态

唯一目标为 `Polar0216/polar-vocab-data-test` / `data/state.json`。**尚未连接或写入**；Private 属性、默认分支和文件存在情况均未真实验证。不得把不可访问的 404 当成空数据。

沿用既有客户端与内存凭证，用户在可信的正式网站设置界面手动输入只限此仓库、Contents 读写的 Fine-grained PAT。先只读测试、核对 Private/分支/快照、保存备份并确认，才能创建首个测试快照。已有数据不能自动覆盖。详见 [GITHUB_SETUP](../../docs/GITHUB_SETUP.md)。

## 7. 真实 GitHub API 测试结果

目前只完成匿名的公开基础设施读取：公开仓库页面、Git refs、站点 HTTP；GitHub REST 元数据匿名请求在当前网络返回 403，原因未确定。它不是用户受限 PAT 的授权/限流测试，也不能证明真实同步 API 失败或成功。

| 验收项 | 本次状态 |
| --- | --- |
| GitHub 形状的 GET/PUT/SHA/ETag、错误、网络与限流 | 模拟 API 测试通过 |
| 正式站浏览器 CORS、受限 PAT 认证和权限 | 尚未验证 |
| Private 检查、可访问分支、无文件与无权限区分 | 模拟 API 测试通过；真实未验证 |
| 真实 GET、PUT 创建/更新、SHA 与 ETag | 尚未验证 |
| 真实 Token 失效后重授权、网络中断恢复 | 尚未验证；模拟覆盖 |
| 真实 API 限流恢复 | 尚未触发，不能标为通过 |

保留客户端安全边界：固定 GitHub API 来源，禁止重定向、Cookie 与缓存，错误信息不输出凭证，容量预算与 SHA 比较不变。

## 8. 双设备同步与冲突测试结果

| 项目 | 本地与模拟证据 | 真实远端状态 |
| --- | --- | --- |
| A 英德词条新增 | 独立数据库与浏览器模拟通过 | 尚未验证 |
| B FSRS / ReviewEvent / due | 实际 ts-fsrs 与同步模拟通过 | 尚未验证 |
| C 离线不同新增 | 合并、pending 与恢复模拟通过 | 尚未验证 |
| D 独立字段合并 | 三方合并模拟通过 | 尚未验证 |
| E 同字段冲突 | 三方副本、人工决议与审计模拟通过 | 尚未验证 |
| F 删除/编辑 | 墓碑及原始修改保留模拟通过 | 尚未验证 |
| G Good/Again 分叉 | 两独立浏览器、决议传播及后继评分模拟通过 | 尚未验证 |
| H 幂等/失败恢复/并发 | 上传时新增/评分、响应丢失、ACK 故障、重启与租约模拟通过 | 尚未验证 |

自动化浏览器请求均被本机假 GitHub 拦截；两个标签页锁测试和两个独立浏览器数据空间测试都不是连接真实私人仓库。具体真实执行步骤、反馈和证据要求见 [REAL_DEVICE_CHECKLIST](../../docs/REAL_DEVICE_CHECKLIST.md)。

## 9. iPhone 真机测试状态

**尚未验证，需要用户在上线后操作。** 已准备 14 项 Safari / 主屏幕 PWA 清单，包含安装、剪贴板拒绝回退、英德录入、离线编辑/FSRS、重开、内存凭证重新授权、Windows 同步、原始事件/分叉及以后版本更新的数据保留。

Edge 手机尺寸是 Chromium 模拟，不等于 iOS。首次发布不能证明跨版本 SW 更新；后续有获批准的新版本时再验证。反馈步骤见 [真机清单](../../docs/REAL_DEVICE_CHECKLIST.md)，不反馈 Token、请求头或个人备份。

## 10. 数据安全与 Token 检查结果

本地公开树、生产构建和 Git 实际待公开索引分别检查；未发现常见 GitHub PAT / 私钥特征、真实私人词库或学习记录。测试夹具仅为人工数据。模式扫描不是对未知私人内容的完整识别保证，已结合文件逐类审查。

`.gitignore` 补齐本机代理目录、凭证/密钥、数据库、浏览器 profile 和临时产物；`node_modules/`、`dist/`、`.env*`（仅公开 `.env.example` 例外）、数据/备份、截图/trace/HTML 测试报告均不公开。

原 Phase 1/2/3 报告含本机账号路径，为保留原件采用 **Git clean-only filter**：磁盘原件不改；送入索引的公开版本把项目绝对路径替为 `<project-root>`。已验证过滤幂等、原件字节保留；没有 smudge 私人路径。旧规划和所有历史报告原件的 SHA-256 与公开版本摘要见 [HISTORICAL_REPORTS.json](HISTORICAL_REPORTS.json)。公开索引检查同时拒绝本机账号路径和常见私人邮箱；提交作者使用 noreply。

Token 内存策略、备份不含凭证、断开不清库、恢复撤销旧 SHA、SW 不缓存 API 和日志不含授权信息均保留既有模拟验收。真实云端快照、正式站控制台与设备尚未验证；本次没有接收、生成、读取或落盘真实 PAT。

## 11. 实际执行的测试命令和结果

环境：Windows、Node 24.13.0 / npm 11.6.2 / Git 2.53.0.windows.1。依赖版本没有改变；`npm ls --depth=0` 成功，package/lock/已安装直接依赖一致。锁文件 version 3、604 个 package 条目，resolved 包使用 npm 官方 registry、完整性字段存在，无带凭证下载地址。

| 命令 | 实际结果与适用范围 |
| --- | --- |
| `npm run typecheck` | 本地通过（也由 check 串行执行） |
| `npm run lint` | 本地通过，0 warnings（也由 check 执行） |
| `npm test` | 本地 17 文件 / 225 测试通过（也由 check 执行） |
| `npm run check` | 本地通过，串行执行类型、lint、测试、Pages 构建、产物与凭证检查 |
| `npm run build:pages` | 本地通过，默认 `/polar-vocab/`（由 check 执行） |
| `npm run check:dist` | 本地通过，子路径、manifest、SW、CSP、静态外壳检查（由 check 执行） |
| `npm run check:secrets` | 本地通过，源文件和生产树无识别的凭证或私人数据目录（由 check 执行） |
| `npm run check:public-index` | 本地实际 Git 索引通过；文件数量/体积以该命令输出和发布清单为准 |
| `npm audit`、`npm audit --json` | 两次在线审计均成功，0 个已知漏洞；不是对未来漏洞的保证 |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e` | 31 passed / 3 skipped，共 34 项，约 1.1 分钟 |
| `git diff --cached --check` | 额外格式检查有提示：既有 CRLF 被默认规则当作尾随空白；识别 CRLF 后仅剩原规划两份各 4 行 Markdown 双空格换行及旧 UI 测试末尾空行，保留原件，不标为全树通过 |
| 历史原件哈希、过滤幂等、公开文件/文档链接检查 | 本地通过；原件未改 |

3 个 E2E 跳过项是手机项目中重复的进程重启场景；对应桌面场景全部执行通过，没有删除测试。浏览器测试按现有 Edge 通道执行，没有重复下载浏览器。受限环境下本机服务器/浏览器与匿名网络读取在允许后执行，结果为真实本地执行结果。

补充格式核对实际执行 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check`，退出 2，仅有上述 9 条旧格式提示。它不是功能测试失败；未为消除提示改写规划书、历史报告或降低现有测试约束。

当前构建主入口约 406.03 kB（gzip 126.58 kB）、Dexie chunk 95.20 kB（gzip 31.30 kB）、设置 chunk 67.33 kB（gzip 20.72 kB）、CSS 42.23 kB（gzip 9.11 kB）；SW 预缓存 28 项约 793.91 KiB。本次没有修改业务代码、CSS 或提高构建警告阈值。CI Linux、真实站和设备性能未验证。

## 12. 已修复的问题

本次发布准备修复：公开文件排除规则不足、历史报告包含本机路径、Git 作者可能暴露私人邮箱、main 部署被新运行中断的风险、非 main 手动运行无须上传 Pages 产物，以及缺少真实设备和首次发布检查记录。

具体修改限于 `.gitignore`、报告过滤器及 `.gitattributes`、公开索引检查脚本和 npm 命令、现有工作流的小幅保护改动、文档与发布报告。没有发现需修改同步协议或清库的证据，因此不改协议和核心功能。没有把尚未发生的线上问题称为已修复。

## 13. 尚未验证的功能和原因

- 首次公开 push：用户要求明确批准后才能执行；当前停在该边界。
- GitHub 写入身份、远端提交、Actions Linux 构建、Pages Source/环境和正式 HTTPS 站：需要获准推送及实际运行；站点目前 404。
- 私有测试仓库 Private/分支/文件、真实 CORS/权限/GET/PUT/SHA/ETag：用户尚未在可信网站输入受限凭证；不通过聊天取得 PAT。
- A–H 真实远端双设备和真实失效凭证/断网恢复：须完成上线与两端安全授权后执行；主动异常优先模拟，不破坏测试仓库。
- 真实限流、容量极限和低性能设备压力：未触发或未测，保留现有预算和提示，不伪造通过。
- iPhone Safari 安装、剪贴板、存储驱逐、离线和发布更新：需用户真机反馈；已有逐项清单。

## 14. 是否具备进入 Phase 4 的条件

**当前不具备完整验收条件，不进入 Phase 4。** 本地回归和首次发布准备已完成；等待明确批准公开推送。后续应取得 Actions/Pages 证据、真实私有测试仓库 API 与 A–H 多端验收、用户 iPhone 反馈，修复实际发现的问题并更新本报告。

下一步获批后的命令和顺序见 [DEVELOPMENT](../../docs/DEVELOPMENT.md)。覆盖/删除远端内容、非测试私库写入、降低保护及其他仓库操作均不在本次首次 push 授权内。
