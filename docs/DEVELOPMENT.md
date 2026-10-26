# 开发、测试与部署

工程基线 Node 24 LTS / npm 11，实际 Node 24.13.0、npm 11.6.2。使用 npm ci 按精确 package-lock.json 安装，.npmrc 开启 exact 与 engine-strict。0.6.0 沿用现有精确锁文件，没有新增 npm 依赖。后面的 Phase 3.5、Phase 4 和 0.5.0 发布记录属于历史；当前状态见整合发布报告，不将旧验收结论扩展到新版本。

## 0.6.0 整合工程

当前桌面版本见 `apps/desktop/package.json`。日常使用同一个便携 exe 与稳定 `%APPDATA%\Polar Vocab\Capture`，不要求隔离启动器。SQLite、连接目标及设置都在 `captures.sqlite`；日志在 `logs/`，迁移备份在 `migration-backups/`，Chromium runtime 缓存在同级 `Capture.runtime`。后者在迁移目标之外，避免 Electron 提前创建缓存使首次迁移失效。

只有开发/验收才使用 `POLAR_VOCAB_CAPTURE_DATA_DIR` 指向**全新**测试路径；对应 runtime 目录为该路径加 `.runtime`。不要以该变量让新版原地打开旧 v1 数据库。自动迁移仅查旧默认 `%APPDATA%\Polar Vocab Capture`；独立 0.4.1/0.5.0 源需在新空库通过 UI 显式迁入。使用 SQLite 在线备份包含已提交 WAL，原目录和身份不改写，失败停止并保留资料。详见 [迁移与回滚](INTEGRATED_MIGRATION.md)。

结构化词典、句译和明确的词形关系沿用免 Key Provider。外部查询可以完全关闭；词典与翻译分别记录来源。生产连接 IPC 不接收 Token，PAT 由独立原生窗口输入；选择记住后存 Windows Credential Manager，启动后异步只读核验。网络失败保留，已保存授权 401 清除，断开后不再自动连接。详见 [安全授权](INTEGRATED_AUTH.md) 和 [文本流程](INTEGRATED_TEXT_FLOW.md)。

常规验证：

```sh
npm run typecheck
npm run lint
npm test
npm run test:desktop
npm run desktop:build
npm run build:pages
npm run check:dist
npm run check:secrets
```

E2E 须先构建，Web 和桌面分别使用本轮独立输出；不要把 backup/profile 放入 `--output`，Playwright 会清理该目录：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e -- --reporter list --output reports/test-results/integrated/web-local
npm run test:desktop:e2e -- --reporter list --output reports/test-results/integrated/desktop-local
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

这些命令中的 GitHub 通常为人工模拟；实际 Windows 安全存储/进程测试也不等于真实 GitHub 授权成功。真实 Provider、真实原生选区与快捷键、真实私库、正式站部署应单独记录。词典网络完成耗时不可冒充快捷键至可见反馈耗时，未达到目标就保留未验证或失败状态。实际命令、数量和失败重跑见 [整合报告](../reports/integrated/INTEGRATED_RELEASE_REPORT.md)。

保留旧产物的便携打包：

```sh
npm run desktop:runtime
npm run desktop:build
npx --no-install electron-builder --projectDir apps/desktop --config electron-builder.json --win portable --x64 --publish never --config.directories.output=../../artifacts/desktop/integrated-0.6.0
```

此目录必须是本次专用输出；不要重用含需保留资料的目录，builder 可能清理目标。离线已有匹配运行时可另加 `--config.electronDist=../../node_modules/electron/dist`，保留校验和第三方通知。构建脚本编译 `SelectionHelper.exe` 与 `CredentialHelper.exe`，随应用资源打包；仅 Windows 桌面打包需要它们，Pages 不打包原生 exe。

公开 Web 构建生成 `release.json`，声明版本、采集/状态协议 1/2 与 `context-morphology`。桌面所有上传入口在核对正式站后才可发送，新网站部署与行为验证之前保持暂停；只读授权检查和本地收藏仍可用。工作流中不设置私人 PAT，不将私库内容写进公开构建。

本轮已获普通 main 推送及 Pages 部署授权；执行前仍须核对实际提交、历史报告脱敏、发布清单、远端无意外新提交及独立克隆安全。只允许正常 push，不允许 force，不自动创建 Release 或上传 exe。部署后的实际状态必须记录，不能预先标为成功。

## 桌面工程基线（Phase 4 起）

根目录统一锁文件，`apps/desktop/package.json` 只定义应用元信息与生产入口，不建立第二份锁文件。

| 新增/覆盖依赖 | 精确版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| electron | 44.9.0 | MIT及随附Chromium通知 | React窗口、托盘、快捷键、网络 |
| electron-builder | 26.15.3 | MIT | Windows x64便携打包 |
| esbuild | 0.28.2 | MIT | 主进程及preload打包 |
| @electron/get override | 5.1.0 | MIT | 统一下载库，移除旧漏洞依赖链 |

曾尝试审计建议的builder26.5.0，但其旧tar依赖带来高/严重漏洞，未采用。最终最新builder加全局get5.1覆盖已完成实际打包；未来更新仍需复查。内建 `node:sqlite` 在当前Node24仍提示experimental，版本锁定并有事务/重启测试，不保证升级自动兼容。

```sh
npm run desktop:runtime
npm run desktop:build
npm run desktop:dev
npm run test:desktop
npm run test:desktop:e2e
npm run desktop:package
```

`desktop:runtime` 显式运行Electron下载脚本，保留官方校验。当前Electron npm包的普通安装不保证二进制存在。Pages只需类型，工作流设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`，不构建桌面或加入原生文件。

Windows构建需 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`、UIAutomationClient/Types及WindowsBase。不安装Rust/MSVC或全局键盘工具。构建输出未签名，不购买证书，不自动发布Release。捆绑依赖许可证保留在应用内 `build/THIRD_PARTY_NOTICES.txt`，Electron/Chromium通知随运行时分发；源码自身暂UNLICENSED。

普通桌面E2E默认跳过外部供应商请求。真实翻译验收显式设置PowerShell `$env:PHASE4_LIVE_TRANSLATION='1'` 后再运行，消耗免费匿名额度；结果使用独立文件名保存到 `.cache/phase4-real-desktop/e2e/provider-results-*.json`。英语/德语候选需人工核对，不能仅凭HTTP成功证明语义正确。

| 路径 | 管理方式 |
| --- | --- |
| `apps/desktop/build/` | 构建中间文件，忽略Git |
| `artifacts/desktop/` | 便携exe及win-unpacked，忽略Git |
| `reports/test-results/phase-4/` | Web/桌面自动输出，按任务子目录重建 |
| `reports/playwright-report/phase-4/web`、`desktop` | 自动HTML报告 |
| `.cache/phase4-real-desktop/`、`.cache/phase4-real-windows/` | 人工验收证据及隔离配置，不放进E2E清理目录 |
| `.cache/phase4-preservation/` | 历史资料哈希与依赖检查证据 |

现有 Phase 3.5 资料不迁移、不清空。自动测试只写全新合成数据库，内部验收可用专用 `POLAR_VOCAB_CAPTURE_DATA_DIR` 覆盖默认 AppData；0.6.0 日常启动不再依赖此变量或隔离启动器。导出不覆盖已有备份。桌面E2E/打包只在Windows本机执行；Linux Pages增加共享/SQLite单元测试，不冒充Windows实测。

Phase 4 首次公开时审查了实际索引/清单、秘密模式、SQLite/profile/产物忽略、历史报告 clean-only filter、npm audit、Pages 及桌面产物。后续发布仍须按本轮授权范围核查再普通 push，不 force；不把exe作为源码Gitblob，不自动创建GitHub Release。首次Linux CI使用Node24.21.0/npm11.19.0，发现旧锁文件缺失Tailwind WASM包内捆绑的两个emnapi依赖；已用npm11.19.0在无node_modules的隔离目录重生成锁，并实际ci安装成功，不改变直接依赖版本。不要用旧npm的dry-run代替干净安装。再生锁推荐同版本 `npx --yes npm@11.19.0 install --package-lock-only --ignore-scripts`，随后实际 `npx --yes npm@11.19.0 ci`；本轮Linux远端复验结果见报告。

## 依赖与许可证

| 直接生产依赖 | 锁定版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| react / react-dom | 19.3.0 | MIT | 页面 |
| react-router-dom | 7.18.4 | MIT | Hash 路由 |
| dexie | 4.4.6 | Apache-2.0 | 本地数据库结构 |
| zod | 4.6.7 | MIT | 输入与交换模型校验 |
| ts-fsrs | 5.4.2 | MIT | Phase 2 真实调度，算法模块惰性加载 |
| papaparse | 5.7.0 | MIT | CSV/TSV解析与CSV转义 |
| read-excel-file | 9.3.12 | MIT | 惰性本地XLSX只读解析 |
| fflate | 0.8.3 | MIT | XLSX实际展开预算检查与测试夹具 |
| uuid | 14.0.3 | MIT | 固定namespace的同步UUIDv5派生 |

| 直接开发依赖 | 锁定版本 | 许可证 |
| --- | --- | --- |
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| tailwindcss / @tailwindcss/vite | 4.3.3 | MIT |
| vite-plugin-pwa | 2.0.0 | MIT |
| workbox-window | 7.4.1 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| eslint | 10.12.0 | MIT |
| @eslint/js | 10.0.1 | MIT |
| typescript-eslint | 8.71.2 | MIT |
| eslint-plugin-react-hooks | 7.1.1 | MIT |
| eslint-plugin-react-refresh | 0.5.7 | MIT |
| globals | 17.13.0 | MIT |
| @types/node | 24.19.2 | MIT |
| @types/react / @types/react-dom | 19.3.0 | MIT |
| vitest | 5.0.4 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @testing-library/dom | 10.4.1 | MIT |
| @testing-library/jest-dom | 7.0.1 | MIT |
| @testing-library/user-event | 14.6.8 | MIT |
| jsdom | 29.1.1 | MIT |
| fake-indexeddb | 6.2.5 | Apache-2.0 |
| @playwright/test | 1.64.0 | Apache-2.0 |
| @types/papaparse | 5.5.2 | MIT |

MIT 与 Apache-2.0 允许使用与再分发，仍需遵守声明保留等义务。没有复制其他背词项目的大段源码。自己的代码尚未选分发许可，package 为 private + UNLICENSED；依赖许可不会自动替项目选许可证。后续导出分发包时保留第三方 license/notice。锁文件涵盖传递依赖，升级前重新审查审计与兼容性；安装曾提示传递 `glob@11.1.0` 弃用，来自构建工具链，不在浏览器业务中运行，当前 audit 无已知漏洞，升级需关注上游修复。

参考：[Vite 环境要求](https://vite.dev/guide/)、[Tailwind Vite 安装](https://tailwindcss.com/docs/installation/using-vite)、[PWA 更新策略](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html)。


## 常用命令

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run check
npm run build:pages
npm run check:dist
npm run check:secrets
npm run preview
npm audit --json
```

check 串行执行类型、lint、Vitest、Pages 构建、产物路径和公开树检查。E2E 另行执行，构建完成后再启动，避免构建替换 hash 资产影响浏览器。开发默认根路径，不注册 SW；preview 默认 http://127.0.0.1:4173/polar-vocab/。无需 Python；可选图标脚本需 Pillow，现成 PNG 已保留。

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

也可先 npx playwright install chromium 再 npm run test:e2e。自动 trace/截图只写 `reports/test-results/e2e/`，HTML 在 `reports/playwright-report/`（均忽略提交），手写阶段报告在 reports/phase-0～phase-3.5。Playwright 会清理其输出目录，真实验收备份、控制脚本和 profile 必须放在输出目录之外；当前恢复备份位于忽略的 `.cache/phase3.5-real-sync/`。仓库自带的模拟测试使用人工词条与隔离 IndexedDB，请求拦截固定 GitHub 域名，使用人工凭证值。真实私库早期验收由用户在正式网页自行输入受限PAT，不生成包含凭证的截图/trace。后续用户在聊天主动提供两枚测试凭证，并明确授权临时测试使用；不在shell参数或文件中传递、不输出值或请求头，凭证未写入项目、备份或公开产物，验收结束后由用户撤销。受限沙箱若无法启动本机预览/浏览器，需环境允许后执行，不能标为通过。

本次首次重跑完整 E2E 时，旧 outputDir 为 `reports/test-results/`，启动清理误删了其中临时实时验收脚本、4份原始JSON备份及acceptance JSONL；该轮已停止、退出1，不算通过。没有删除受跟踪原件或损坏私库数据，也没有暴露PAT。打开的A/B数据已各重新导出一份完整备份到 `.cache/phase3.5-real-sync/`，分别核对5词/2卡/4评分/1墓碑/1决议、pending=0，B保留3份冲突审计；另存恢复元数据。旧临时原始产物不再完整保留，已观察工具输出仍是报告证据。输出目录隔离后的新一轮E2E退出0，31通过/3项有意跳过/34总项，约1.1分钟；配置更改后类型检查和lint亦单独重跑通过。

## 测试与故障注入

保留模型、数据库/迁移、CRUD、CSV/TXT/XLSX/ZIP、剪贴板、完整备份、实际 ts-fsrs、原子评分/CAS、日配额/时区、导航/主题与离线 PWA 的旧测试目的。

新增 tests/unit/sync：api.test 使用 GitHub 形状的 fake-github fetch，覆盖 GET/Create/Update/ETag、401/403/404/409/422/429/500/503、限流、网络/超时/模糊写入、容量与公开目标拒绝；engine.test 使用两个独立数据库，覆盖三方、墓碑、捕获幂等、重复模板、FSRS 分叉/决议/后继、上传新写入、响应丢失和 ACK 故障恢复、SHA 竞争、租约；safety.test 覆盖上传同时真实评分、已连接仓库变公开、恢复撤销授权、复杂字段、未知字段、线性多事件分支和 1001 词/40 真实评分的规模场景。

新增 E2E sync.spec 覆盖真实浏览器 fetch、只读预览/备份确认、状态、离线/恢复、刷新与进程重启后重新授权、字段冲突/决议、两标签锁、独立浏览器设备复习分叉/决议后评分、320px、JSON 无凭证和 Cache Storage 无 API。浏览器 API 全部拦截为本机模拟，不是 GitHub 实仓库通过。手机是 Chromium 模拟，不是真 Safari。

任何新事务服务先加载所需算法/模块，再进 LocalVocabularyService.transaction；不要在 IDB 事务里等 fetch 或动态 import。所有业务和 outbox 同事务；复习事件/墓碑不可变。engine 仅通过共享 snapshot/事务写同一库，不建平行存储。协议变更先增加拒绝/迁移/旧夹具测试。

## GitHub Pages 与 PWA

.github/workflows/deploy.yml配置Node24检查及最小权限Pages发布，PR仅验证，不读取私库/PAT。首次push9b138265成功，Configure Pages 404后用户修正Source并重跑；attempt2 Success现已由公开API元数据独立核对。修复提交 `982b023c7158b9e6924c1683f1ed564fd29b8259` 普通推送成功；[运行38702050828](https://github.com/Polar0216/polar-vocab/actions/runs/38702050828)与build/deploy均success，逐步元数据确认Linux类型/lint/单元/构建/安全/公开索引及Chromium E2E成功。未读取原始日志或声称CI测试数量。正式站首次18项UI及SW证据不替代修复后F/G完整复验。

首次 push 获批准后，在已有仓库的 Settings → Pages → Build and deployment → Source 选 GitHub Actions，并检查 Pages 环境规则。CI 默认 /<仓库名>/，用户根站或自定义域名在 Actions Variables 设公开 PAGES_BASE_PATH=/。Token 绝不放 VITE_*、.env 或 Actions。

```powershell
$env:PAGES_BASE_PATH = '/another-repo/'
npm run build:pages
node scripts/check-dist.mjs /another-repo/
npm run test:e2e
Remove-Item Env:PAGES_BASE_PATH
```

根路径用 npm run build:root，配套 preview/E2E 同时设 PAGES_BASE_PATH=/。默认子路径 HashRouter、manifest id/start_url/scope/icons、SW scope 和导航回退一致。Workbox 只预缓存全部静态 chunk（包括懒模块），无 API runtimeCaching；cache:no-store API 不进 SW。prompt 更新由用户确认，不强制重载学习页。

CSP 在生产 HTML 注入：script/self、connect/self + api.github.com、object/none、base/form/self、worker/self，开发不干扰 HMR。样式有 unsafe-inline 兼容现有 UI，不等于允许远程脚本。GitHubClient 绑定原生 fetch 的全局调用上下文；模拟 Node fetch 无此约束，必须保留真实浏览器测试。

首页不执行网络同步模块。设置页按需加载；FSRS 只创建/评分/核验时执行；Dexie 独立 vendor 资产便于跨更新缓存，没有提高 500 kB 警告阈值。拆分后主入口与 vendor 总量仍要观察，不能把单入口变小等同总下载降低。

## 真实多端与设备（部分待验收）

以下为 Phase 3.5 历史记录。Web 按 [GITHUB_SETUP](GITHUB_SETUP.md) 仅对人工私库验收，不输出或持久化 PAT；0.6.0 桌面可经本人选择由 Windows 安全存储记住授权，与历史 Web 内存方案不同。修复专项20/20、check227及E2E31/3通过后发布982b023，08:09:52UTC原记录F/G全量一致，A–G真实通过。H幂等、收词冻结批次F1已确认/L1后写仍保留、评分F1已确认/L2事件+卡片仍保留并最终两端收敛均通过；同profile的A2标签被同步租约正确阻止，无多余PUT。门闩控制Node曾Route already handled中断，重启后A7词且冻结批次/后写pending保留，重新授权从原批次恢复为两端7词；修正忽略的路由工具后重新测试ACK，未把旧中断追记通过。离线新增/刷新保留全部存储记录和原pending ID通过；随后用户明确授权临时测试凭证，经一次性内存通道交给原A/B网页，实际只读预检、备份确认、原pending同步及最终收敛通过。12:09:43UTC两端各14词/3卡/5评分，原事件ID唯一保留，全部共享集合与SHA一致、pending/冲突/活动任务均0。真实401未观测到且用户选择保留未验证，因此H仍部分通过；普通重授权不替代401。

旧profile因先前清理后存储访问失败而AbortError，实际失败不当正常SW更新通过。保留旧目录、关闭/中断旧会话，新 `.cache/phase3.5-real-sync/fixed-profile-A/`、`fixed-profile-B/` 经空库备份及正常UI恢复原JSON，原事件ID/审计保留、新本机身份不同；撤销连接/SHA后用户自行预检/确认同一私库，原F/G已通过。后来H控制工具中断也保留原批次与后写操作，真实进程重启恢复已验证；无需清库/重建远端或提取/注入凭证。

iPhone真机仅用独立人工数据。用户反馈iOS26.6的第1–3、6、8通过，另对明确询问的离线Good评分及关闭重开反馈通过，因此第9、10项也记用户报告通过。第4项剪贴板导入正常但单次计数未知，第5项拒绝回退、第7项德语结构字段、第14项跨版本更新尚未验证；用户明确暂缓第11–13项真机同步，继续保留未验证，本轮不再催促。公开Actions元数据已独立核对，原始日志未读；桌面旧profile更新失败不替代正常SW升级。本轮可执行部分结案，整体尚未完整验收，该轮未授权Phase4；现有另行授权允许Phase4，未测项仍保留。

收尾 `verify-local.mjs` 实际通过6原件哈希、39相对链接、141条清单、25份JSON产物、21份完整备份及19个匹配SHA的canonical远端基线检查，无识别PAT/凭证字段/远端local-only字段且均被忽略。已关闭控制器，并经沙箱外检查确认进程退出，Node REPL内存已reset；这不替代用户在GitHub撤销临时测试凭证。后续新增文件或文档提交需重新做相应公开检查。

IndexedDB 可能被系统/用户清理；持久存储申请不能代替备份。系统时钟错误会影响学习 due，旅行时区重新归属当地统计日。900,000 字节云端上限、20 MiB 备份上限、整库验证与事件回放 CPU 均有规模限制，低性能真机尚无性能基准。分片/压缩仅设计。

## 首次公开前的 Git 检查

公开目标仅 `Polar0216/polar-vocab`；私有测试目标仅 `Polar0216/polar-vocab-data-test`，不可混用。先只读检查远端历史，严禁 force push；按本轮已有授权执行普通发布，授权范围之外不执行 push。

历史报告原件保持原始字节及哈希，发布版本用 Git clean filter 去掉本机账号路径。首次发布工作区已经设置下列**仓库本地**配置，未修改全局 Git：

```sh
git config --local filter.public-report.clean "node scripts/public-report-filter.mjs"
git config --local filter.public-report.required true
```

.gitattributes 仅对 reports/phase-*/*.md 使用该 clean filter。它只处理送入索引的 stdin，不改磁盘原件；不提供还原私人路径的 smudge。其他电脑 checkout 得到的是脱敏公开版本，已用独立克隆和实际索引检查验证。开发者若更新报告，先配置 filter 再 git add。公开索引检查会拒绝残留本机账号路径、私人邮箱、常见凭证、环境/私库/浏览器/构建产物。CI 也运行这一检查；本机原件不同于发布 blob 是有意的隐私处理。

Git 不传递仓库本地 filter 配置或其 required 标记。新克隆未配置 filter 时，Git 可以按原样暂存新报告，过滤器本身不是完整的防泄漏机制。每次提交前须本地配置并运行 check:public-index，未知内容仍需人工审查；CI 只在 push 后检查，不能阻止已经发生的公开。此检查识别常见凭证/路径模式，不承诺识别所有私人内容。重新添加整个旧工作区或绕过检查前必须再次审查，不能假定文件名属于报告就安全。

```sh
git diff --cached --stat
npm run check:public-index
git diff --cached --check
git status --short --branch
```

RELEASE_FILES.txt 列出全部待公开相对路径，人工夹具是源码中的合成数据，不是私人词库。只有 .env.example 的公开路径模板允许提交。初次本地提交使用仓库本地 noreply 邮箱，避免把原全局私人邮箱写入公开 Git 作者记录。

用户明确批准后，先重新只读核查远端，再执行普通 `git push -u origin main`。若出现新远端提交、拒绝 non-fast-forward 或目的地变化，停止分析，不能用 force 绕过。Git Credential Manager 已存在；本次普通首次推送已验证写入权限。以后缺身份时采用其浏览器登录，不在聊天索取密码/PAT。

Pages 配置入口：<https://github.com/Polar0216/polar-vocab/settings/pages> → Build and deployment → Source → GitHub Actions。当前工作流保留运行中的 main 部署，PR 可取消陈旧检查；只有 main 非 PR 才上传/发布 Pages artifact。工作流使用 npm ci 和锁文件、固定官方 Action SHA、最小权限，无私人 PAT。

首次运行[38687892583](https://github.com/Polar0216/polar-vocab/actions/runs/38687892583)的Configure Pages 404及用户修正Source/重跑均保留历史；attempt2已由API元数据确认success。修复运行[38702050828](https://github.com/Polar0216/polar-vocab/actions/runs/38702050828)对应982b023，build/deploy均由API独立确认成功。元数据成功不等于已经读取原始日志，也不替代F/G及正常SW更新的行为验收。

本次正式站验证复用了现有 shell/vocabulary/review 中18项适用于外部来源的用例，独立Edge profile、人工本地数据，无PAT/私有API。临时配置与补充manifest/SW/TXT脚本曾放在忽略目录，后被上述E2E输出清理误删，不能声称原始临时产物仍完整保留；已经观察到的工具结果如实记录，仓库中原有测试保留。真实HTTPS来源下的成功不能替代修复后私库完整收敛或其余iPhone验收。

真实测试顺序、证据记录与 iPhone 清单见 [REAL_DEVICE_CHECKLIST](REAL_DEVICE_CHECKLIST.md)。本地或模拟通过不能替代上线、CORS/权限及真机验收。


## Phase 4.1 / Capture 0.5.0

无新增npm依赖，沿用锁文件。词典采用免Key公开WiktApi，中文独立使用MyMemory；许可、免费额度和处理限制见 DICTIONARY_PROVIDERS.md。测试夹具为人工数据，实际服务测试必须显式开启，不能用mock结果代替真实网络。

常规：npm run check；npm run test:desktop；npm run desktop:build。

桌面回归：npm run test:desktop:e2e -- --reporter list --output reports/test-results/phase-4.1/desktop-final

真实服务专项（PowerShell）：先设置 $env:PHASE41_LIVE_DICTIONARY='1'，再运行 npm run test:desktop:e2e -- --grep 'LIVE public' --reporter list --output reports/test-results/phase-4.1/live-provider-electron。测试只用perseverance/run/Haus/gehen；消耗免费查询额度，不需要PAT。结束后用 Remove-Item Env:PHASE41_LIVE_DICTIONARY 撤销当前终端开关。

Web：设置 $env:PLAYWRIGHT_CHANNEL='msedge'，运行 npm run test:e2e -- --reporter list --output reports/test-results/phase-4.1/web-e2e。移动项目仅为Edge中的窄屏模拟，不代表iOS验收。

打包使用独立输出 artifacts/desktop/dictionary-0.5.0；本机已用缓存的Electron/NSIS和--publish never成功生成便携版。构建时不要覆盖历史产物或正在使用的profile。原npm run desktop:package默认会使用桌面公共产物目录，保留历史时应显式传--config.directories.output选择全新目录。

以上为 0.5.0 阶段当时状态：当时未推送或部署，也未使用真实 GitHub 私库。当前 0.6.0 仍要求先升级公开 Web、审查新增公开文件和发布清单，再按本轮已有授权普通推送；实际结果见整合报告。
