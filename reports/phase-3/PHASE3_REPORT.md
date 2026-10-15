# Polar Vocab — Phase 3 实施与验收报告

交付日期：2026-10-15（Asia/Shanghai）。工作区：<project-root>。基于既有 Phase 0–2，共用本地词库、FSRS、事务、pending 和备份，没有另建一套学习状态。

**已经实现：** 私有仓库同步客户端、内存授权、规范化快照、三方合并、持久化批次/ACK/租约/恢复、冲突 UI 和决议。**仅模拟测试通过：** 下述 API、独立设备、故障与 Chromium 浏览器场景。**真实远端通过：没有。尚未验证：** 专用 GitHub 私有仓库、iPhone Safari、线上 Pages/Actions、实际发布 SW 更新。本次未创建仓库、生成真实 Token、Git 初始化、push 或部署；Phase 3 后停止。

## 1. 实际实现功能

设置提供 owner/repo/PAT/可选分支、只读测试、云端预览、备份与明确确认、重新授权、手动/自动同步、断开保留本机。状态区显示未连接/需授权/同步中/已同步/pending/离线/Token 失效/错误/冲突/不兼容，以及目标、最近确认时间、队列/冲突数量和最近确认云端摘要。本机规模提前预警，超限阻止上传，无强制覆盖按钮。

同步前后沿用本地事务和实时查询；网络等待不锁学习，未冲突卡片可继续。完整评分事件、采集、回执、墓碑与参数保留；处理 UUID 合并、独立字段、删除编辑、语义重复模板和并发复习。确认时可以明确采用云端共享设置或保留本机设置的新共同修订。

src/features/sync 分 protocol/merge/engine/persistence/resolutions/SyncSettings；integrations/github/client 是独立 REST 层；storage/sync-models 是本机协议。页面和算法按需加载，原工程目录与 docs、reports 清楚分开。原规划书及前三阶段报告未删改。

## 2. GitHub API 使用方式

固定 api.github.com HTTPS，API header 2026-03-10。GET 仓库私有状态/实际名称、分支和 Contents 可读，GET state.json 获 Base64 内容及 blob SHA，PUT 创建不带 sha、更新带本轮 SHA。每轮重验私有目标，改名/重定向不自动接受，404 复核仓库/分支/读取权限；已有 base 后文件消失不自动重建。只读测试不宣称写权限已经验证。

ETag 条件请求降低未变化下载，同 SHA 已验证快照小型内存缓存；提交仍检查最新版本，ETag 不是 PUT SHA。写请求串行成批。401/403/404/409/422/429/5xx 与网络、超时、中断分开处理；正文接收也受超时和 2 MB 传输预算约束，不把私密错误正文显示到 UI。主/次级限流遵守可读响应头，无可读头至少一分钟退避；409 最多三次。

依据 [Contents 官方文档](https://docs.github.com/en/rest/repos/contents)、[最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) 和 [CORS 文档](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) 核对。真实浏览器 CORS/头可见性、分支规则及平台策略仍需真实测试仓库验证。

## 3. Token 授权与存储

用户自行创建 Fine-grained PAT，仅指定私有数据仓库 Contents: Read and write，有限有效期、不同设备独立撤销。GitHubClient 使用私有内存字段，刷新/进程重启重新授权；断开、401、恢复/清除撤销内存凭证。不写 localStorage/sessionStorage/IndexedDB、URL、日志、备份、环境变量或 Actions。

固定 API 域名、redirect:error、credentials:omit、cache:no-store；生产 CSP 限制脚本同源及网络域名。React 将恶意导入内容渲染为文字；无第三方运行脚本，无前端 OAuth secret 或记住凭证功能。默认浏览器存储与 GitHub Private 都不是端到端加密，恶意扩展/设备软件仍可读运行内存。

## 4. 云端文件格式与版本

```text
data/state.json
{format: polar-vocab-state, protocolVersion: 1, schemaVersion: 1,
 snapshotId: UUID, snapshot: DataSnapshot}
```

snapshotId 与 snapshot.id 必须匹配；严格 Zod、引用、状态身份及真实 FSRS 回放核验。source 和决议新字段已统一到首个正式远端协议；旧无 source 记录可读，未知字段/未来版本不裁剪写回。集合 UUID 排序，对象编码字典序，业务数组保留顺序，同逻辑数据稳定序列化。远端不含 LocalBackup 的本机数据。

720,000 UTF-8 字节预警、900,000 硬上限；本机估算提示，候选提交精确检查，远端超限拒读/写。GitHub 完整小文件接口 ≤1 MB，本版不进入大文件媒体类型分支。超限完整本机与 JSON 备份保留，绝不截断评分历史。未来分片/归档只设计。

## 5. 三方合并

B=已确认完整基线，L=冻结本机，R=最新验证远端。新增 UUID 并集；有共同基线按 L=R、L=B、R=B 及字段比较；无基线同 ID 不同内容保守冲突。稳定身份先校验，不用时间或 UUID 大小判胜。

普通数组原子，已有语言结构/设置可按明确叶子合并；contexts 无删除时逐 ID，有删除时整字段比较。安全独立字段先保留；选择远端冲突字段仍保留独立本机标签。合并修订由正文和父修订 UUIDv5 确定。不可变事件/墓碑 ID 相同负载去重，不同负载阻止覆盖；摄取回执并集与固定 UUIDv5 保证同 capture 首次双端摄取只一词。

卡片调度字段作为原子组，沿事件/决议因果证明后继，不能逐值平均。语义相同不同 UUID 卡片冲突，停止两张调度，选择一张后另一张软删除并永久保留历史和墓碑。没有把缺记录解释成删除。

## 6. 冻结、ACK 与请求恢复

syncJobs 落盘完整 B/L/operations/candidate/expectedSha/连接代次，远端 PUT 前保存候选。失去响应或 ACK 事务失败后，刷新/进程重启可恢复未确认批次，先 GET；远端等于持久化候选最终状态才幂等确认，不分配新词/事件 ID。

ACK 在同一事务核对租约和连接代次，冻结 L/当前 working/确认 candidate 再合并，写完整 base+SHA，只删除捕获 operation UUID，保留上传中新的收词/评分/冲突。未确认、网络失败、本机事务失败都不清空队列。远端又变化而无法证明相同候选时保守重合并/冲突，不凭超时 ACK。

本机 lease 90 秒、20 秒心跳，崩溃过期；跨端 SHA CAS 三次有限重试及 1/2 秒退避。自动默认关，15 秒合批、至少一分钟尝试间隔、有限失败重试；联网/前台/会话结束触发，不依赖关闭事件。断开不能保证撤销已在途 PUT，之后不发新请求，ACK 再检查代次。

## 7. 词条冲突

保留基线/本机/远端可检查副本，二次确认选择争议字段；决议新 revision 引用双方候选，完整副本保存在 conflictDecisions 及备份。重新 GET 发现新远端变更仍重新冲突。旧冲突刷新替换为新冲突时保留审计，不堆重复 UI 按钮。

删除与编辑保留永久删除，编辑副本可导出后参考新建 UUID；不能复活旧 ID。身份变化、不可变同 ID 不同内容及物理删除历史没有覆盖按钮，要求备份和核查远端历史。

## 8. FSRS 分叉与人工决议

相同 cardId/parentStateId 兄弟评分全部保留并停止卡片调度。选择合法分支追加 ReviewResolution，记录根、线性终点、忽略另一分支及后继、新 resultingStateId 和原合法终点状态；原事件不重写、不线性串联、不平均。

ReviewEvent 可选 parentResolutionId、ReviewResolution 可选 selectedHeadEventId 明确桥接。决议后评分同时引用决议新父状态及终点事件，结构与真实算法核验。忽略事件不计有效统计但仍备份/同步。测试覆盖两端 Good/Again、两侧原始历史、选择线性多次分支、再次同步和下一次真实评分。

复杂嵌套、多层分叉或并发决议不能证明唯一终点时拒绝自动修补，保留全部证据和本机其他卡片使用；这是当前明确技术边界。

## 9. 数据库与迁移

Dexie v3、17 表。保留 v1 的 11 表、v2 的偏好/回执；只新增 connections、syncJobs、syncLeases、conflictDecisions。v1/v2→v3 无清库、不改旧业务行。业务 schema1，云端 protocol1，本机备份 v2，三个版本独立。

模型强化状态身份不可跨卡片、事件/决议 resultingState 唯一、合法决议父引用和参数/状态一致性。未知或损坏数据停止事务，不猜测迁移。

## 10. 备份与恢复

LocalBackup v2 在原 local 集合追加连接摘要、完整批次和字段审计；无 Token，不备份临时 lease。旧 v1 不含新字段时显式补空集合升包装，然后完整验证，原记录不改。严格旧客户端不能读 v2，不能宣称双向兼容。

恢复要求前置完整备份和确认、指纹检查、历史/墓碑/不可变身份保护及原子落库，保留当前 deviceId；连接/凭证/旧确认 SHA/base/活动任务不继承，任务仍在原备份供审计。冲突、ReviewResolution、原始历史保留。重新连接必须只读确认合并，缺记录不代表远端删除；清本机也不删远端。

## 11. 实际测试与故障结果

环境：Windows、Node24.13.0、npm11.6.2、Microsoft Edge。生产依赖没有新增/升级，继续 React19.3、Dexie4.4.6、Zod4.6.7、ts-fsrs5.4.2 等锁定版本，完整列表见 DEVELOPMENT。

| 实际命令 | 结果 |
| --- | --- |
| npm run typecheck | 通过，应用/工具/测试 |
| npm run lint | 通过，0 warnings |
| npm test | 17 文件、225 项通过 |
| npm run check | 类型/lint/225 测试/Pages/产物/公开树全部通过 |
| npm run build:pages | /polar-vocab/ 构建通过 |
| npm run check:dist | 资产、manifest、PNG、SW 作用域及外壳通过 |
| npm run check:secrets | 通过；手写文档/报告与 dist 扫描常见凭证和私人目录 |
| $env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e | **31 通过、3 有意跳过、0 失败（34 项）** |
| npm audit --json | 0 个已知漏洞，依赖未改 |
| 规划书 SHA256 | 两份保持 65FF8BA7FADC81A7EBDB8352D7824D012144CCCD986E2294F141D39442FD45AA |

保留 184 项旧测试目的，增加 41 项同步 API/引擎/安全与规模测试；数据库和备份断言更新为真实 v3/v2，并保留旧 v1 备份和 v1/v2 DB 迁移。225 项含人工模拟错误码、限流头、超时/正文停滞、响应丢失、GET/PUT/CAS、ACK 回滚、两独立库、捕获幂等、重复模板、复习决议与后继、上传中收词/真实评分、公有目标拒绝、不兼容/手改远端、锁、恢复撤销授权及 1001 词条/40 真实事件。

E2E 保留五页面、主题/刷新/320px、离线导入/学习、JSON、PWA、双标签 CAS和进程重启；新增连接/预览确认/状态/离线恢复/字段决议/锁/两个隔离浏览器 FSRS 分叉及下一评分/重新授权/JSON 无凭证/缓存无 API。手机是 Chromium 模拟。三个跳过项为词库/学习/同步的重复手机进程重启场景，这三项均已在桌面真实进程重启执行。最终 320px 同步设置截图已查看，无横向溢出；自动产物集中在 reports/test-results 与 reports/playwright-report。Markdown 交付链接检查通过。

开发回归发现并修正：原生 fetch 必须绑定全局调用上下文；冲突导入与当前 working 再合并产生同一分叉两份 UI，现按语义去重且归档旧副本；选择单个冲突字段不能覆盖已独立合并标签；决议状态必须与终点事件、参数严格匹配。一次浏览器回归与重建重叠产生旧 hash 资产404，已改为固定构建后运行浏览器，没有降低旧测试目的。

## 12. 真实 GitHub 验收状态

**未完成。** 当前没有 Git/远程仓库或用户提供的专用私有测试目标，本次明确禁止擅自代办。网络实现已可独立运行，但模拟响应不是 GitHub 的真实权限/CORS/规则/限流行为证明。

由用户按 [GITHUB_SETUP](../../docs/GITHUB_SETUP.md) 创建已初始化私有测试仓库、在可信设置页输入最小权限凭证，并执行双设备/离线/撤销/冲突清单。不要提供真实 PAT 到聊天。未修改其他私人仓库或部署 Pages。

## 13. 遗留技术问题及风险

尚未验证：真实 GitHub、iPhone Safari/主屏幕 PWA、线上 Actions/Pages、实际发布 SW 升级与多标签更新、低性能设备规模性能。复杂嵌套/并发决议保守阻止，不可变同 ID 损坏需人工核查，不提供篡改历史按钮。

单快照上限是当前可用边界，不做分片/事件压缩。整库结构/引用校验、合并及实际回放随规模增加；1001词/40事件只证明该人工规模，不能代表多年历史真机性能。IDB可能被系统清理；JSON不替代设备安全，GitHub Private也不是端到端加密。

最终主入口约406.03 kB/gzip126.58，Dexie vendor95.20/gzip31.30，设置页约67.33/gzip20.72、FSRS23.48/gzip7.75；没有 >500 kB chunk 或抬高阈值。主入口变小不等于初次总下载减少，入口+vendor仍约501 kB；SW预缓存28项约792.55 KiB，包含懒分块。

浏览器没有服务器校时，设备时间/时区会影响 due/日统计。CSP不能防恶意扩展；审计0与模式扫描只覆盖现有公告及常见特征，不能证明绝对安全。项目自身仍 UNLICENSED，分发许可需所有者决定。

## 14. 下一阶段 Windows 接口准备

共享 CaptureEvent.payload、UUID/device/schemaVersion、UTC日期、固定 UUIDv5、摄取回执、不可变负载验证及 outbox 已存在。本阶段只给协议和网络/错误处理基础；没有全局快捷键、桌面浮窗、独立队列程序、按设备/月 captures 远端扫描或 iOS 原生快捷指令。

Windows 后续应只写自己的采集队列，不修改 FSRS 或主快照，重试沿用原 capture UUID，并复用固定向量和 SHA CAS。先完成真实 Phase3 专用仓库及手机验收，再经新的明确授权实施 Phase4。**到此停止，不自动继续。**
