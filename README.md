# Polar Vocab

个人英语、德语词汇收集与间隔复习系统，目标是 GitHub Pages 静态 PWA + IndexedDB 本地优先 + 独立 GitHub 私有数据仓库。无需自建服务器、Serverless 或云数据库。

**当前版本实现 Phase 3 GitHub 私有仓库同步，模拟多端验收通过；真实 GitHub 尚未验收。** 支持英德词汇收集、整理、文件与剪贴板导入、导出备份；从已整理词条明确创建词义卡，翻卡后通过四级自评安排下次复习，查看任务与历史。数据、设置和待同步操作均保存到 IndexedDB，首次缓存完成后可离线使用。

FSRS 使用锁定的 ts-fsrs 5.4.2，卡片、评分事件和待同步操作原子保存。GitHub Contents API、内存 PAT、三方合并、持久化批次与冲突决议已经接入。Windows 客户端和 iOS 快捷指令仍未实现。

## 本地启动

使用 Node.js 24 LTS（24.0 以上）与 npm 11。依赖精确锁定，使用 npm，不混用 pnpm/yarn 锁文件。

```sh
npm ci
npm run dev
```

开发地址由终端输出，默认 `http://127.0.0.1:5173/`。开发模式不注册 Service Worker。

```sh
npm run check
npm run preview
```

默认生产预览地址为 `http://127.0.0.1:4173/polar-vocab/`。用 `#/inbox` 等 Hash 路由访问子页面，刷新仍请求同一个静态入口。第一次联网访问并等待外壳缓存完成后才具备基础离线能力。

浏览器验收：

```sh
npx playwright install chromium
npm run test:e2e
```

Windows 已安装 Edge 时，也可使用 PowerShell `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e`。手机项目是 Chromium 设备模拟，不等于 iPhone Safari 真机验收。

## 文件夹与项目资料

| 位置 | 内容 |
| --- | --- |
| `src/`、`public/`、`tests/`、`scripts/`、根目录工程配置 | 项目代码、资源、测试与开发工具；仍从根目录运行 npm 命令 |
| [docs/](docs/README.md) | 需求、架构、数据模型、同步设计和开发说明 |
| [docs/reference/](docs/reference/README.md) | 原始规划资料，保留原件内容 |
| [reports/](reports/README.md) | 阶段实施报告及本地生成的浏览器测试报告 |
| `node_modules/`、`dist/` | 依赖与构建产物，均不提交 |

- [完整规划书](docs/PROJECT_PLAN.md)：原件位于 `docs/reference/`，两份内容相同，未删改。
- [架构与模块职责](docs/ARCHITECTURE.md)
- [数据模型与校验规则](docs/DATA_MODEL.md)
- [同步协议与恢复规则](docs/SYNC_DESIGN.md)：实际实现及安全边界。
- [开发、依赖、测试和部署方法](docs/DEVELOPMENT.md)
- [Phase 0 实施与验收报告](reports/phase-0/PHASE0_REPORT.md)
- [Phase 1 实施与验收报告](reports/phase-1/PHASE1_REPORT.md)
- [Phase 2 实施与验收报告](reports/phase-2/PHASE2_REPORT.md)

## 使用本地词库

1. 生词箱填写词形和语言，其他字段选填；事务提交完成后显示「已保存到本机」。
2. 编辑词条补充释义、例句、标签、英语搭配和变形、德语冠词/复数/变位；「已整理」不创建复习卡片。
3. 文件或剪贴板导入先检查语言、映射、错误行和重复处理。重复默认跳过，补充模式只填写已有词条的空字段。
4. 定期到设置导出完整 JSON 备份。CSV 是词汇交换格式，不能无损替代 JSON。恢复和清除前必须先下载当前备份并明确确认。

本机替换恢复会拒绝未知版本、损坏引用、同事件 ID 不同内容，以及会丢失已有删除证据的旧备份。恢复预览后如果词库被其他页面修改，需要重新预览。当前不提供合并恢复。

CSV/TXT/XLSX 最大 5 MiB、5,000 行；XLSX 另外限制实际解压体积、条目和行列范围。JSON 完整备份最大 20 MiB。iPhone 使用 Safari 主动点击「从剪贴板导入」，权限受限时长按文本框粘贴；真机 Safari 与主屏幕 PWA 仍需按开发文档手动验证。

## 使用本地复习

1. 为词条补充至少一条释义并标记「已整理」，在词库选择单条或批量「加入复习」，检查数量后确认。暂停卡片仍占用原模板，应恢复而非重复生成。
2. 复习页选择英语、德语或混合，开始后先回忆，再显示答案，使用 Again / Hard / Good / Easy 评分。空格翻卡、数字 1–4 评分，输入框与详情弹窗内不触发快捷键。
3. 默认新卡上限英语 10、德语 5；设置可调整配额与保持率 0.70–0.99。新卡上限只限制首次学习，到期旧卡和再次到期的学习步骤不受限。参数修改影响后续评分，保留已有到期时间和历史。
4. 暂停学习、退出或刷新后，从已保存卡片和事件重建任务。暂停卡片、归档词条和未整理词条不参与任务；删除词条保留卡片正文、事件与墓碑。

今日和最近 7 天按设备当前 IANA 时区的本地日历日统计，界面显示时区。评分次数、独立卡片数和首次学习卡片数分开；旅行改变时区会重新归属日期，绝对到期时刻不变。学习页面每 15 秒及回到前台时刷新到期任务；再次到期后点击继续学习。

JSON 备份包含真实 FSRS 状态及完整复习事件，恢复时核验实际算法结果。旧 Phase 1 无学习记录备份可安全校验恢复；若会丢失本机已有复习历史、删除证据或回退到旧调度状态，则拒绝覆盖。未知算法、无效权重和不兼容 schema 不会自动修补。当前不提供历史合并或重置学习进度。

## 数据与部署边界

公开仓库只存网站代码、文档、静态图标和人工测试样例。私人词库、复习记录和 PAT 不得放入本项目、公开构建或任何 `VITE_*` 环境变量。Token 只由用户在设置页面输入并在内存中使用，刷新后重新授权。不会写入浏览器持久存储、备份、URL、日志或 SW 缓存。

`.github/workflows/deploy.yml` 已配置检查、构建和 Pages 发布；Phase 3.5 已准备本地 main 和指定 origin；公开仓库已存在，首次 push 正等待明确批准。Pages 设置和真实部署尚未验收。工作流在未来获授权推送到 `main` 时才会部署，PR 仅验证。

生产 `base` 默认 `/polar-vocab/`，CI 根据仓库名生成；个人根站点或自定义域名须设 `PAGES_BASE_PATH=/`。完整方法见开发文档。项目代码暂为 `UNLICENSED`，公开分发前由项目所有者选择许可；第三方库许可见依赖表。

## 使用 GitHub 私有同步（Phase 3）

先阅读 [GitHub 设置教程](docs/GITHUB_SETUP.md)，核实已有的 `Polar0216/polar-vocab-data-test` 为 Private 且有可访问分支，再生成仅针对该仓库的 Contents 读写 Fine-grained PAT。不要将凭证发送到聊天。

设置 → GitHub 私有同步：填写 owner / repo / 可选分支 / PAT → 只读测试 → 查看本机与云端数量、设置及文件大小 → 保存完整备份 → 明确确认。之后可手动同步或开启批量自动同步。离线照常学习，上传失败保留 pending。

同字段编辑、删除与编辑、同词同模板重复卡片、并发评分进入冲突区。复习决议保存原始事件和 ReviewResolution，决议后的评分引用明确父状态。没有强制覆盖云端按钮。断开连接保留本机记录，恢复备份会撤销连接和已确认 SHA，重新连接必须再次确认合并。

远端是 `polar-vocab-state` 协议 1 / schema 1；本机备份是独立 LocalBackup v2，旧 v1 备份经显式包装迁移读取。Dexie v3 无清库升级。单快照上限 900,000 UTF-8 字节，720,000 起预警，绝不截断历史。

[故障排查](docs/SYNC_TROUBLESHOOTING.md) · [Phase 3 实施报告](reports/phase-3/PHASE3_REPORT.md)。真实私有仓库、iPhone Safari、远程 Pages/Actions 和实际发布升级尚未验证；没有生成真实 Token 或擅自推送部署。Phase 3.5 当前只进行发布前检查，推送前必须明确批准。

## Phase 3.5 首次发布准备

- 公开代码仓库：[Polar0216/polar-vocab](https://github.com/Polar0216/polar-vocab)。
- 预期站点：[Polar Vocab](https://polar0216.github.io/polar-vocab/)，当前仍待首次获批准推送与 Pages 发布，不能将本地 preview 视为线上验收。
- 唯一私有测试目标：`Polar0216/polar-vocab-data-test`。用户在网站设置手动输入仅此仓库的受限 PAT；不发送到聊天。
- [发布前检查报告](reports/phase-3.5/PHASE3_5_REPORT.md) · [完整待公开文件](reports/phase-3.5/RELEASE_FILES.txt) · [真实多端与 iPhone 清单](docs/REAL_DEVICE_CHECKLIST.md)。

本地历史报告原件不改写。Git clean filter 仅将它们的待公开 blob 中本机工作区路径替换为 `<project-root>`；重新提交报告前按开发文档配置过滤器，并执行 `npm run check:public-index` 检查实际 Git 索引。依赖、构建、浏览器产物、个人配置与私人数据不提交。
