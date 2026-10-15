# Polar Vocab — Phase 2 实施与验收报告

交付日期：2026-10-15（Asia/Shanghai）。工作区：`<project-root>`。基于既有 Phase 0/1 工程完成 FSRS 本地学习闭环；未重新初始化工程、Git 或远程仓库。本阶段完成后停止，不自动进入 Phase 3。

## 1. 已实现功能

- 词库和生词箱均提供单个/批量「加入复习」，先显示可创建数量再确认。要求词条未删除、已整理且至少有一条释义；默认 meaning 模板。暂停卡片仍占用原模板，不能重复生成。
- 卡片管理支持英德筛选、真实 FSRS 状态和下次 due、暂停/恢复、原始词条及复习历史。词条修改不重置学习状态，删除仍保留软删除正文、墓碑和历史。
- 复习页支持英德混合或单语言、正面回忆、显示答案、Again/Hard/Good/Easy、持久化后下一张、详情、会话暂停和继续。
- 正面不提前渲染释义；答案面展示已保存的释义、语境、搭配及德语结构等。空格翻卡、数字 1–4 评分，输入框/详情弹窗/长按重复键不会误触评分。
- 到期旧卡优先；新卡按英语/德语剩余额度安排。Learning/Relearning 当天再次到期会重新进入任务，等待页提示可继续，不会因已经评分过就永久移除。
- 首页显示真实词条数、活动卡片、现在到期、今日评分次数/独立卡片/新学习卡片、英德进度及近七天每日统计表。
- 设置提供英德每日新卡上限、保持率和语言任务偏好。参数修改只影响以后评分，不重排已有 due 或改写历史。
- 离线评分、刷新、关闭页面和实际浏览器进程重开后，依据 IndexedDB 恢复进度与剩余任务；未评分的翻开状态不作为持久化学习结果。
- 完整 JSON 保留卡片和事件；恢复验证真实算法结果，拒绝不兼容版本、旧进度回退和丢失当前历史的覆盖。

主要文件：

| 位置 | 内容 |
| --- | --- |
| `src/features/review/fsrs-adapter.ts`、`scheduler.ts` | 唯一算法入口、默认参数、序列化与回放 |
| `review/service.ts`、`daily-tasks.ts`、`state-validation.ts` | 卡片事务、幂等/CAS、每日任务、统计和状态约束 |
| `review/ReviewWorkspace.tsx`、`ReviewPage.tsx`、`use-learning.ts` | 翻卡、管理/历史、实时查询与时间刷新 |
| `review/CreateCardsButton.tsx`、`client.ts` | 创建确认与算法服务惰性加载 |
| `review/LearningOverview.tsx`、`LearningSettings.tsx`、`integrity.ts` | 统计、参数设置、恢复核验 |
| `src/features/vocabulary/service.ts`、`VocabularyManager.tsx` | 共享事务/outbox 边界和建卡入口 |
| `src/features/import-export/backup-service.ts` | 学习记录保留及恢复验证 |
| `src/app/App.tsx`、`src/styles.css`、首页/设置 | 路由懒加载与延续原风格的响应式学习界面 |
| `tests/unit/review/`、`tests/integration/review-ui.test.tsx`、`tests/e2e/review.spec.ts` | 算法、事务、交互和真实浏览器验收 |

代码和工程配置仍在标准工程目录，需求/设计在 `docs/`，报告在 `reports/phase-0/`、`phase-1/`、`phase-2/`。自动截图/trace、HTML 测试报告分别集中在 `reports/test-results/`、`reports/playwright-report/`，忽略提交。

## 2. FSRS 版本与实际调度方式

沿用 **ts-fsrs 5.4.2，MIT**，未新增或升级任何依赖。开发前读取已安装包的 `package.json`、`dist/index.d.ts`、相关 `dist/index.mjs`，并核对 [官方文档](https://open-spaced-repetition.github.io/ts-fsrs/)。该包报告使用 **FSRS-6.0**；包版本和算法代际不是同一概念。

新卡来自 `createEmptyCard`；完整配置来自 `generatorParameters`；评分调用真实 `next`。默认保持率 0.90、maximumInterval 36,500、fuzz=false、shortTerm=true，学习步骤 1m/10m、重学步骤 10m，21 项权重直接读取库默认值。没有自写遗忘曲线或固定天数表。

FsrsAdapter 是唯一执行算法的源码模块，备份核验也复用其回放入口。参数先校验，拒绝旧权重的隐式填充/迁移和超范围裁剪。UI 只显示四级名称及描述，提交后显示实际 due，没有编造预计间隔、稳定度或保持率。

## 3. 卡片与事件数据结构

沿用既有 Flashcard、ReviewEvent、SchedulerConfiguration、AppSettings、PendingOperation；没有平行模型。

- Flashcard：稳定 UUID、词条 UUID、模板、suspended、完整 FSRS 状态、stateId、lastReviewEventId、revision/父 revision、算法/设置版本、创建及更新时间、删除时间。
- FSRS 状态完整保存 due、stability、difficulty、elapsed_days、scheduled_days、learning_steps、reps、lapses、state、last_review。Date 只在适配层边界转换，持久化为 UTC ISO 字符串；弃用但仍存在的 elapsed_days 不丢弃。
- ReviewEvent：独立唯一 UUID、设备、卡片、父/新 stateId、父事件、评分时间及等级、完整配置快照、beforeState/afterState、算法和设置版本。业务评分只追加 add，不 put 覆盖原历史。
- New/Learning/Review/Relearning 沿用库的 0/1/2/3；Suspended 是独立管理布尔值，不能替代 FSRS 状态。

仅 meaning 模板开放；冠词、反向和拼写仍只保留类型。词条仍默认进入待整理，标记已整理本身不建卡。

## 4. 数据库版本及迁移

数据库仍为 **Dexie v2、13 张表**，保留原 `version(1)` 和 `version(2)`。业务 `schemaVersion=1`、`backupVersion=1` 均不变，无新表、无清库迁移，之前的 v1→v2 升级测试继续通过。

新功能使用已经预留的 cards、reviewEvents、pendingOperations、settings 和墓碑结构。每日计数、当前任务和已翻开状态不单独持久化，避免重复来源漂移；刷新后从完整记录推导。

Phase 1 的原结构继续可读。本阶段强化的是学习运行时与恢复的语义校验；不兼容算法、无效参数或不连续事件不能借 schemaVersion 相同绕过验证。原始规划书两份 SHA256 仍为：

```text
65FF8BA7FADC81A7EBDB8352D7824D012144CCCD986E2294F141D39442FD45AA
```

原始规划书及 Phase 0、Phase 1 报告均保留，没有覆盖或删减。

## 5. 原子评分及重复提交防护

GradeCommand 携带 eventId、cardId、expectedRevisionId、expectedStateId 和 rating。服务在同一个 IndexedDB rw 事务中：

1. 校验记录、期望修订、父状态、资格、真实到期时间及当前配额。
2. 核对同 ID 是否已有事件；同操作返回原事件，不再次扣额度或写 pending，不同操作拒绝。
3. 检查当前卡片与末次不可变事件一致、父状态尚未评分；调用适配器取得真实结果。
4. 追加 ReviewEvent、更新卡片状态与 revision，追加 append-review 和 upsert-card。
5. 完整快照校验并提交；任一失败整体回滚。事务中没有网络请求或模块加载等待。

UI 另有忙碌锁、按钮状态和稳定的当前操作 ID，但正确性不依赖按钮 disabled。不同事件 ID 基于同一旧状态提交也会被服务拒绝。刷新若遇到已提交操作会看到新状态，未提交操作没有半成品事件；服务层相同请求在新实例中可幂等重试。

失败时保留卡面和输入，不假装成功或进入下一张。若提交已经成功而后续任务读取失败，会明确区分「评分已保存、任务读取失败」。

## 6. 多标签页冲突机制

本机 rw 事务串行持有业务表写权限，状态检查和写入处于同一事务。A/B 从同一卡片基线开始时，仅第一个有效评分可提交；第二个请求的 revision/stateId 过期，不能覆盖第一个事件。

UI 保留当前卡面的基线，用 liveQuery 发现另一页面评分、暂停或删除后显示更新提示并阻止旧卡面评分，要求重新读取任务。测试覆盖两独立数据库连接竞争，以及两个实际浏览器标签页。

查询发现已有同父兄弟事件时停止该卡调度，历史原样保留。这是本机保护，**不是跨设备同步或人工 ReviewResolution 已实现**。跨端分叉、决议和后续父状态衔接仍由 Phase 3 完整验收。

## 7. 学习统计计算规则

到期按绝对时间 `due <= now`。事件时刻保存 UTC，显示和日历分组采用设备当前 IANA 时区，页面显示该时区与日期；不是简单截取 UTC 日期。近七天用七个当地日历日期，支持夏令时 23/25 小时日。时区变化会改变事件所属当地日期，绝对 due 不变，没有新增每事件时区字段。

| 指标 | 计算 |
| --- | --- |
| 总词汇 | 未删除的独立词条，包括待整理/归档 |
| 总卡片 | 未删除卡片，与词条数分开 |
| 活动卡片 | 未暂停、词条已整理/有释义、支持的模板/算法且无兄弟分支 |
| 现在到期 | 启用语言的活动非 New 卡片 due≤now，含逾期；分开显示 Review 和学习/重学步骤 |
| 今日新学习 | 当地今天 beforeState.state=New 的独立 cardId 数 |
| 可学新卡 | 按语言 `max(0, dailyNew - 今日已新学)` 截取有效 New 卡 |
| 今日/近七天评分次数 | 有效 ReviewEvent 数；同卡一天多次评分计多次 |
| 今日独立卡片 | 当地今天评分记录按 cardId 去重 |

归档、未整理、软删除或暂停卡片不参与当前任务；过去事件仍在历史统计中。语言任务偏好只是控制参与任务，不修改 suspended 状态。已决议的 ignoredEventIds 不计有效次数，原始事件仍保存。

新卡上限只限制首次学习，不拦截旧卡或再次到期的步骤。任务每 15 秒和回到前台时刷新；到期后点击继续学习。退出/刷新重建剩余队列，不重新获得当天新额度。

## 8. 备份与恢复兼容

继续采用 LocalBackup v1 包装，完整保存卡片、复习事件、捕获、墓碑、设置及本机 outbox/基线。真实复习后导出、清除、恢复、重复恢复与继续学习均已验证。

旧 Phase 1 无卡片/事件备份可按同一格式验证恢复。若会移除本机已有 ReviewEvent/ReviewResolution、丢失墓碑、改变同 ID 不可变内容、产生重复活动模板或把卡片退回仍有后续评分的旧状态，则拒绝覆盖，保留原库。已知 schema 但未知算法/无效权重也拒绝，不静默修补。

恢复在预览及落库前核验真实算法结果、状态和引用，回放不写回重算历史。仍须下载当前安全备份并明确确认；预览后任何本机修改使确认失效。只支持 replace-local，没有数组拼接合并、新空间或学习重置功能。

明确的本机全量清除是既有独立操作，须备份、勾选并输入确认文字，整体清除并重建默认配置；不等于常规复习事件删除或向远端发删除。恢复后保持当前设备身份，已确认远端 SHA/base 清空，历史事件设备来源不改写，不能继承授权。

## 9. 实际测试命令及结果

最终环境：Windows，Node **24.13.0**、npm **11.6.2**，已安装 Microsoft Edge。单元测试使用 fake-indexeddb，调度核心使用真实 ts-fsrs；浏览器测试使用真实 IndexedDB 和生产 preview。

| 实际命令 | 最终结果 |
| --- | --- |
| `npm run typecheck` | 通过：应用、工具配置及测试类型检查 |
| `npm run lint` | 通过：0 warnings |
| `npm test` | **14 个文件、184 项通过** |
| `npm run check` | 全部串行检查通过；包含本表类型、lint、测试、Pages 构建、产物与公开树子命令 |
| `npm run build:pages` | `/polar-vocab/` 构建通过，没有 >500 kB chunk 提示 |
| `npm run check:dist` | 资产、manifest、图标、SW 注册/作用域及离线入口通过 |
| `npm run check:secrets` | 通过，扫描手写文档/报告和 dist；自动浏览器产物忽略提交 |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e` | **22 项通过、2 项有意跳过、0 失败** |
| `npm audit --json` | **0 个已知漏洞**；无新增依赖 |
| 规划书 `Get-FileHash -Algorithm SHA256` | 两份仍与既有记录一致 |

184 项包含保留原目的的 Phase 1 测试 144 项，以及 Phase 2 算法 9、卡片服务 12、每日统计 5、学习备份 5、交互 9 项。人工协议夹具改为真实默认权重和算法结果，仍检查原有模型、引用、备份与删除语义；懒加载导航测试改为等待查询，没有删掉先前测试目的。

新增浏览器场景覆盖：实际 UI 批量整理与确认建卡，四级评分、快速双击只写一次、离线评分、刷新/关闭页面、真实浏览器进程重启、JSON 下载/清除/恢复、已满新额度下 Learning 再次到期、同一会话等待页更新及继续、双标签页旧卡面拒绝、320px。固定时间场景只控制浏览器时钟，不 mock 算法或手改 FSRS 状态。

两个跳过项是手机模拟项目里重复的浏览器进程重启场景；词库与学习进程重启都已在桌面执行。手机测试是 Chromium 设备模拟，**不能作为真 iPhone Safari 验收**。

保留五路由、刷新、主题、320px、PWA 外壳及 `/polar-vocab/` 子路径测试。桌面与 320px 学习答案截图已人工查看。生成结果位于 `reports/test-results/`、`reports/playwright-report/`，不是私人学习数据或生产种子。

## 10. 尚未验证内容和风险

**尚未验证：** 真 iPhone Safari/主屏幕 PWA 的学习与剪贴板、系统安装、真实发布后的 SW 升级与多标签页更新、远程 Actions/Pages。当前没有 `.git` 或远程仓库；没有创建、推送或部署。Phase 0 根路径/其他自定义 base 的历史记录未冒充本阶段线上验收。

真机步骤：先在 HTTPS 站点缓存并安装；从已整理词建卡，确认正面隐藏答案及四个触控评分按钮；断网评分后刷新/关闭重开，核对事件与 due；等待学习步骤到期继续，次日核对新卡额度；使用真实文件导出/恢复学习备份。只用独立测试词库验证清除。完整清单见 [DEVELOPMENT](../../docs/DEVELOPMENT.md)。

性能与维护：

- 主 JS 从 Phase 1 的 **578.28 kB / gzip 181.88 kB** 降到 **494.66 kB / gzip 155.75 kB**；FSRS 单独约 **23.48 kB / gzip 7.75 kB**。采用页面与算法懒加载，没有调高警告阈值；主包仍接近 500 kB，未来增长须持续观察。
- SW 后台预缓存所有静态分块，当前 **27 项、约 743.40 KiB**。懒执行不表示后台不下载；首次未缓存离线无法打开。
- 整库引用校验、任务统计、恢复时逐事件回放仍随词库和日志增长；未完成大规模低性能真机性能基准。
- 设备时间是唯一时钟源，无法保证系统校时；时间倒退会拒绝不合理评分。旅行时区变化会重新计算当地「今天」，当前未提供固定学习日时区设置。
- IndexedDB 可能被用户或系统清理，持久存储申请不能替代完整 JSON。备份输入上限仍为 20 MiB，更大日志需要后续规模方案。
- 旧 Phase 1 中只有结构合法、但算法语义不兼容的人工/外来历史可能被拒绝恢复；保留原文件并要求兼容迁移，不会猜测或清库。
- 复杂模板、撤销评分、学习重置、个性化权重训练、热力图和遗忘预测没有实现；本阶段不需要这些功能。
- 审计为 0 只代表当前已知公告；凭证扫描不等于识别所有隐私文本。本项目只有人工测试夹具，没有真实 Token 或学习记录。

## 11. Phase 3 准备情况

**已经实现的前提：** 独立词条/卡片、完整 FSRS 状态、不可变事件及参数、revision/stateId 因果链、本机 CAS 与幂等、逐条 outbox 原子写入、永久墓碑、捕获去重、完整备份和恢复保护。

**已设计但未实现：** GitHub Contents SHA CAS、冻结批次/attempt/ACK、三方合并、Token 内存授权、跨设备兄弟分支与人工决议；见 [SYNC_DESIGN](../../docs/SYNC_DESIGN.md)。特别需要处理两设备离线为同词同模板创建不同 UUID 的语义冲突，并验证决议状态到后续评分父状态的衔接，不能合并 FSRS 字段或按时间任意选一个。

**本次未开发：** 真实 GitHub API、PAT、Windows 收集器、iOS 原生快捷指令、翻译/在线词典、AI 卡片、多账户及复杂德语专项模板。

Phase 2 到此停止。Phase 3 需要新的明确任务授权，并完成假服务端故障、跨设备/离线分支及真实私有测试仓库验收后，才能声称多端同步完成。
