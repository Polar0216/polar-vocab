# Phase 0 实施与验收报告

日期：2026-10-13。范围：调研、协议、项目骨架。**本阶段已停止于 Phase 0，未进入 Phase 1。**

## 1. 已经实现

- React / TypeScript / Vite 工程、Tailwind、精确 npm 依赖锁、ESLint、Vitest、Testing Library 与 Playwright。
- 首页、生词箱、复习、词汇库、设置五个中文占位页面；统一布局、桌面侧栏、手机底栏、键盘焦点与 Hash 路由刷新。
- 浅色、深色、系统主题，本次会话有效；PWA 图标、manifest、真实安装提示事件与确认更新提示，基础静态离线外壳。
- 六个核心模型及严格 Zod 校验；UUID / schemaVersion 1 / 英德语言字段 / 德语结构 / 删除墓碑 / revision 与复习父状态 / 不可变事件 / 快照引用完整性。
- Dexie v1 的 11 张空表及索引定义，没有接入页面业务或填充种子数据。
- GitHub Pages 构建/部署工作流文件，PR 仅验证，main 才具备部署条件；没有远程执行。
- README、ARCHITECTURE、DATA_MODEL、SYNC_DESIGN、DEVELOPMENT 全部交付，并追加本报告。

原来目录只有 `Polar_Vocab项目规划书.md`，没有 `.git` 或工程；未覆盖任何用户工程文件。文件夹整理后原件位于 `docs/reference/Polar_Vocab项目规划书.md`，规范副本仍为 `docs/PROJECT_PLAN.md`，两文件 SHA256 相同：`65FF8BA7FADC81A7EBDB8352D7824D012144CCCD986E2294F141D39442FD45AA`。未初始化 Git、创建远程、提交、推送或部署。

## 2. 已设计但未实现

- 独立公开代码/私有数据仓库的职责与创建方案。
- GitHub Contents SHA CAS、字段三方合并、永久 tombstone、重复事件、复习兄弟分支、冻结批次 ACK、失败与丢响应恢复、安全权限和 20 项未来验收场景。
- FSRS、GitHub、剪贴板、跨平台收词、文件合并导入/完整 JSON 恢复/导出 ports。
- IndexedDB 事务、迁移、后续本地持久化、Windows 和 iOS 的共享 CaptureEvent 交换协议。

没有实现词库 CRUD、文件解析、剪贴板读取、FSRS 调度、PAT 授权、真实 API/同步、Windows 收集器或 iOS 快捷指令。

## 3. 最终目录

```text
polar-vocab/
├── README.md
├── .github/workflows/deploy.yml
├── public/                         # SVG、PWA PNG、Apple touch icon
├── src/
│   ├── main.tsx / styles.css
│   ├── app/                        # 路由、布局、导航、主题、PWA提示
│   ├── components/                 # Icon / PageHeader / EmptyState
│   ├── domain/                     # common / vocabulary / settings / review / sync
│   ├── storage/                    # database.ts / README.md
│   ├── features/
│   │   ├── home/ inbox/ review/ vocabulary/ settings/
│   │   └── sync/ import-export/ capture/   # 仅接口
│   └── integrations/github/ clipboard/    # 仅接口
├── tests/unit/ integration/ e2e/ mocks/
├── scripts/                        # 构建、产物检查、敏感数据扫描、图标生成
├── docs/
│   ├── README.md
│   ├── reference/Polar_Vocab项目规划书.md
│   ├── PROJECT_PLAN.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SYNC_DESIGN.md
│   └── DEVELOPMENT.md
├── reports/
│   ├── README.md
│   ├── phase-0/PHASE0_REPORT.md
│   ├── test-results/               # 自动生成的截图和trace
│   └── playwright-report/          # 自动生成的HTML测试报告
├── package.json / package-lock.json
├── vite.config.ts / vitest.config.ts / playwright.config.ts
├── tsconfig*.json / eslint.config.js
└── index.html / .gitignore / .npmrc / .env.example
```

`node_modules`、`dist`、`reports/test-results`、`reports/playwright-report` 是本地产物，均忽略；dist 由工作流单独上传。阶段实施报告保留在公开项目中，生成的浏览器测试报告不提交。

## 4. 依赖与版本

主要版本：React/React DOM 19.3.0、TypeScript 6.0.3、Vite 8.3.4、Tailwind 4.3.3、React Router 7.18.4、Dexie 4.4.6、Zod 4.6.7、ts-fsrs 5.4.2（只类型）、vite-plugin-pwa 2.0.0 / Workbox 7.4.1、Vitest 5.0.4、ESLint 10.12.0、Playwright 1.64.0。

全部直接依赖的精确版本与 MIT / Apache-2.0 许可见 DEVELOPMENT 表；传递版本与 integrity 见 package-lock。以 Node 24 / npm 11 为基线，TypeScript 和 jsdom 按插件/Node 支持范围选稳定兼容版，未直接追随不兼容最新版。

## 5. 实际验证

| 实际执行的命令 | 结果 | 覆盖边界 |
| --- | --- | --- |
| `npm install` | 通过；524 packages；audit 0 已知漏洞 | 获取公开依赖和生成锁文件 |
| `npm ci --offline --no-audit` | 通过 | 从缓存按锁文件干净重装 |
| `npm ls --depth=0` | 通过 | 所有直接版本，无缺失/peer错误 |
| `npm run typecheck` | 通过 | 应用、协议、配置和测试 |
| `npm run lint` | 通过，零警告 | 整个源码与脚本 |
| `npm test` | 3 文件 / 54 项通过 | 48模型、1数据库结构、5导航集成 |
| `npm run check` | 通过 | 类型、lint、测试、Pages构建、产物和敏感模式扫描 |
| `npm run build:pages` | 通过 | `/polar-vocab/` 静态构建，生成manifest/SW |
| `npm run check:dist` | 通过 | 子路径资产、manifest、PNG尺寸、SW注册与离线入口 |
| `npm run check:secrets` | 通过 | 常见凭证、私人数据目录；没有真实词库/Token |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e` | 6 项通过 | 实际Edge Chromium桌面/手机模拟，导航刷新、主题、320px、SW作用域、断网刷新与静态缓存 |
| `npm run build:root; node scripts/check-dist.mjs /` | 通过 | 根路径资产与PWA路径 |
| `$env:PAGES_BASE_PATH='/'; npm run test:e2e`（Edge） | 6 项通过 | 根站点浏览器导航、SW作用域与离线刷新 |
| `$env:PAGES_BASE_PATH='/phase0-check/'; npm run build:pages; node scripts/check-dist.mjs /phase0-check/` | 通过 | 改名仓库子路径 |
| 上述 base 下运行 `npm run test:e2e`（Edge） | 6 项通过 | 改名子路径的浏览器/离线验证 |
| 桌面/手机浅色首页、深色设置截图人工检查 | 已检查 | 布局与基础视觉，不替代真机安装 |
| 原规划书与规范副本 SHA256 | 相同 | 无删改 |
| 本地 Markdown 文档链接检查（Node） | 通过 | 交付文档的相对链接均可解析 |
| 额外 Python YAML 解析尝试 | 未执行 | bundled Python 没有 PyYAML；已人工复查结构与官方Action SHA，GitHub实际解析待远程验收 |

测试中曾发现并修复生产 preview 的 base 错配，当前最终产物恢复 `/polar-vocab/`。Vitest 对 PWA 模块使用显式 mock，PWA 实际行为由浏览器测试承担，没有将 mock 测试当作离线验收。

## 6. 尚未验证与技术风险

- **远程 Pages 加载、Actions 成功发布、线上缓存头/升级**尚未验证，因为当前没有 Git/远程仓库且授权明确禁止擅自创建、推送或部署。在线 Phase 0 验收门槛仍需创建仓库后完成。
- **iPhone Safari/主屏幕 PWA、真实安装与跨版本 SW 更新、多标签页升级**未做真机/真实发布测试；Chromium 手机模拟只是布局与静态离线验证。
- **实际 IndexedDB 词库持久化、恢复、FSRS 与双设备同步**尚未实现，因此不能标记其验收通过。
- PAT 运行时安全、浏览器清理存储、离线冲突、快照规模和 iOS 权限差异仍是后续核心风险。当前无 PAT 输入或保存。
- `workbox-build@7.4.1` 传递使用已弃用 glob 11.1.0；安装会提示维护/安全警告，当前 npm audit 未报已知漏洞。保留上游兼容版本，后续更新须关注上游并跑构建回归，不盲目越级覆盖。
- 凭证模式扫描不能证明任意文本都不是私人记录；本次仅人工公开测试样例，没有生产数据种子。项目自己的分发许可尚未选择。

## 7. Phase 1 建议（仅建议，未执行）

先建立 repository/service 边界和原子本地写入（记录+pending），完成语言/词形最小录入、编辑、搜索、标签、状态，保持词条与卡片分离；随后实现完整 JSON 备份/恢复、CSV/TXT/XLSX预览/映射/去重、主动剪贴板读取及手动粘贴兜底。重点验收离线保存后刷新不丢、事务失败不假成功、未知schema拒写，并在真实iPhone Safari和主屏幕模式测试。FSRS/授权同步/Windows继续留在规划书对应后续阶段。
