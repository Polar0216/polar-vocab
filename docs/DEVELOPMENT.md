# 开发、测试与部署（Phase 3.5 发布准备）

工程基线 Node 24 LTS / npm 11，实际 Node 24.13.0、npm 11.6.2。使用 npm ci 按精确 package-lock.json 安装，.npmrc 开启 exact 与 engine-strict。Phase 3 未新增/升级依赖。

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

也可先 npx playwright install chromium 再 npm run test:e2e。自动 trace/截图与 HTML 分别在 reports/test-results、reports/playwright-report（忽略提交），手写阶段报告在 reports/phase-0～phase-3.5。测试使用人工词条与隔离 IndexedDB；模拟请求拦截固定 GitHub 域名，绝不使用真实 Token。受限沙箱若无法启动本机预览/浏览器，需环境允许后执行，不能标为通过。

## 测试与故障注入

保留模型、数据库/迁移、CRUD、CSV/TXT/XLSX/ZIP、剪贴板、完整备份、实际 ts-fsrs、原子评分/CAS、日配额/时区、导航/主题与离线 PWA 的旧测试目的。

新增 tests/unit/sync：api.test 使用 GitHub 形状的 fake-github fetch，覆盖 GET/Create/Update/ETag、401/403/404/409/422/429/500/503、限流、网络/超时/模糊写入、容量与公开目标拒绝；engine.test 使用两个独立数据库，覆盖三方、墓碑、捕获幂等、重复模板、FSRS 分叉/决议/后继、上传新写入、响应丢失和 ACK 故障恢复、SHA 竞争、租约；safety.test 覆盖上传同时真实评分、已连接仓库变公开、恢复撤销授权、复杂字段、未知字段、线性多事件分支和 1001 词/40 真实评分的规模场景。

新增 E2E sync.spec 覆盖真实浏览器 fetch、只读预览/备份确认、状态、离线/恢复、刷新与进程重启后重新授权、字段冲突/决议、两标签锁、独立浏览器设备复习分叉/决议后评分、320px、JSON 无凭证和 Cache Storage 无 API。浏览器 API 全部拦截为本机模拟，不是 GitHub 实仓库通过。手机是 Chromium 模拟，不是真 Safari。

任何新事务服务先加载所需算法/模块，再进 LocalVocabularyService.transaction；不要在 IDB 事务里等 fetch 或动态 import。所有业务和 outbox 同事务；复习事件/墓碑不可变。engine 仅通过共享 snapshot/事务写同一库，不建平行存储。协议变更先增加拒绝/迁移/旧夹具测试。

## GitHub Pages 与 PWA

.github/workflows/deploy.yml 已有 Node24 检查、静态构建、最小权限 Pages 发布；PR 只验证，main 的授权 push 或手动运行才发布。工作流不读取私人仓库或 PAT。当前已准备本地 main、origin=https://github.com/Polar0216/polar-vocab.git，首次 push 尚未批准，未推送或部署。

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

## 真实设备与远端（尚未验证）

先按 [GITHUB_SETUP](GITHUB_SETUP.md) 仅对专用私有测试仓库验证 Contents/CORS/版本/权限/分支规则、双设备和撤销凭证，禁止把 PAT 发进聊天、日志或仓库。[故障手册](SYNC_TROUBLESHOOTING.md) 说明恢复、锁、限流和容量。

iPhone Safari 和主屏幕 PWA 分别验证：可信 HTTPS 首次缓存/安装、主动剪贴板与拒绝回退、Numbers CSV 引号/中文/德语/日期、本地离线编辑/评分/刷新/关闭重开、文件 JSON 下载/明确恢复、授权刷新、两设备离线分叉及决议后继续。只用独立测试数据验证清空。系统安装、真实发布 SW 升级、多标签更新、线上缓存头和远程 Actions/Pages 都需独立验收。

IndexedDB 可能被系统/用户清理；持久存储申请不能代替备份。系统时钟错误会影响学习 due，旅行时区重新归属当地统计日。900,000 字节云端上限、20 MiB 备份上限、整库验证与事件回放 CPU 均有规模限制，低性能真机尚无性能基准。分片/压缩仅设计。

## 首次公开前的 Git 检查

公开目标仅 `Polar0216/polar-vocab`；私有测试目标仅 `Polar0216/polar-vocab-data-test`，不可混用。先只读检查远端历史，再决定是否 fast-forward，严禁 force push；批准前不执行任何 push。

历史报告原件保持原始字节及哈希，发布版本用 Git clean filter 去掉本机账号路径。首次发布工作区已经设置下列**仓库本地**配置，未修改全局 Git：

```sh
git config --local filter.public-report.clean "node scripts/public-report-filter.mjs"
git config --local filter.public-report.required true
```

.gitattributes 仅对 reports/phase-*/*.md 使用该 clean filter。它只处理送入索引的 stdin，不改磁盘原件；不提供还原私人路径的 smudge。其他电脑 checkout 得到的是脱敏公开版本。开发者若更新报告，先配置 filter 再 git add。公开索引检查会拒绝残留本机账号路径、私人邮箱、常见凭证、环境/私库/浏览器/构建产物。CI 也运行这一检查；本机原件不同于发布 blob 是有意的隐私处理。

```sh
git diff --cached --stat
npm run check:public-index
git diff --cached --check
git status --short --branch
```

RELEASE_FILES.txt 列出全部待公开相对路径，人工夹具是源码中的合成数据，不是私人词库。只有 .env.example 的公开路径模板允许提交。初次本地提交使用仓库本地 noreply 邮箱，避免把原全局私人邮箱写入公开 Git 作者记录。

用户明确批准后，先重新只读核查远端，再执行普通 `git push -u origin main`。若出现新远端提交、拒绝 non-fast-forward 或目的地变化，停止分析，不能用 force 绕过。Git Credential Manager 已存在；推送权限尚未验证，缺身份时采用其浏览器登录，不在聊天索取密码/PAT。

Pages 配置入口：<https://github.com/Polar0216/polar-vocab/settings/pages> → Build and deployment → Source → GitHub Actions。当前工作流保留运行中的 main 部署，PR 可取消陈旧检查；只有 main 非 PR 才上传/发布 Pages artifact。工作流使用 npm ci 和锁文件、固定官方 Action SHA、最小权限，无私人 PAT。

真实测试顺序、证据记录与 iPhone 清单见 [REAL_DEVICE_CHECKLIST](REAL_DEVICE_CHECKLIST.md)。本地或模拟通过不能替代上线、CORS/权限及真机验收。
