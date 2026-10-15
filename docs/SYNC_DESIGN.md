# GitHub 私有同步协议（Phase 3）

状态：网络适配器、内存授权、版本化快照、三方合并、持久化批次、冲突决议已实现并完成模拟验收。**真实专用私有仓库尚未验收**，不得据此宣称所有真实设备云端同步通过。原始规划保持不变。

## 1. 双仓库与文件

公开代码仓库 polar-vocab 只交付静态 Pages 应用，不含个人数据或凭证。用户自行创建的 private polar-vocab-data 保存 data/state.json。网站不创建仓库/分支，不运行 Git CLI，不用 Actions 逐卡同步，不接自建后端。

远端是独立 envelope：format=polar-vocab-state、protocolVersion=1、schemaVersion=1、snapshotId 与严格 DataSnapshot。不是含本机 outbox、基线、连接的 LocalBackup。共享全部词条/卡片/不可变事件/墓碑/决议/摄取回执与 AppSettings；设备、默认录入语言、Token、请求状态和未确认批次留本机。

集合按 UUID 顺序、对象按编码字典序规范化，普通数组保持语义顺序。未知字段、未来协议、重复 ID、坏引用、算法/参数不兼容拒绝；不忽略 source 或新决议字段写回旧格式。此前阶段无远端写入客户端，正式跨端发布统一协议1。数据库 v3 与业务 schema1 独立；兼容及 backup v1→v2 包装迁移见 DATA_MODEL。

## 2. GitHub REST 与安全目标

固定 https://api.github.com、X-GitHub-Api-Version: 2026-03-10，Accept: application/vnd.github+json。先 GET 仓库 metadata 验证 private=true、full_name，验证已有 branch 与 Contents 读取。每轮重验私有目标，重定向/改名不静默跟随；只读测试不能证明 PAT 写权限与分支保护允许提交。

GET /repos/{owner}/{repo}/contents/data/state.json?ref={branch} 获取 UTF-8/Base64 文件和 blob SHA。PUT 同路径，body 包含 branch/message/content；新文件省略 sha，更新必须用本轮 GET 的 sha，不把 commit SHA 或 ETag 当 blob SHA。写请求串行，commit message 不含词条或凭证。

404 需要重新验证仓库、branch、Contents 权限，不能凭一次 404 初始化；若已有确认 base 而主文件消失，拒绝重建，要求核查历史。未知格式不覆盖。200/201 必须验证返回 content.sha 形状再 ACK。

ETag/If-None-Match 只减少无变化下载；304 使用已取得文件。Engine 按 SHA 缓存少量已严格验证快照，仍进行新的条件 GET 和 SHA CAS。文件超 900,000 UTF-8 字节拒绝，720,000 起 UI 预警；超限不截断历史，本地继续保存并可导出完整 JSON。

[Contents 官方限制](https://docs.github.com/en/rest/repos/contents) 对 ≤1 MB 支持完整读取，1–100 MB 媒体类型有限制，>100 MB 不支持。本版保守不进入大文件分支。实际 CORS 可见头以真实浏览器为准；[官方 CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) 列出 ETag/限流 reset 等头，Retry-After 不可读时至少一分钟退避，不能假定所有头均可见。

## 3. 首次连接

只读 test 返回密封计划，显示本机和远端数量、大小、预检冲突、共享设置。确认前备份并核对目标，取消不写远端/共享数据；本机变化使计划失效。确认后再次读取，预览不是覆盖授权。

A 空/空：确认后初始化；B 本机有/远端无：显示规模确认后上传；C 本机无/远端有：先验证完整引用和 FSRS 后确认导入；D 双方有：有可信 base 用三方，否则新增 UUID 并集，同 ID 不同内容保守冲突；E 不兼容：拒绝写入，保留本机。

新设备采用远端 singleton settings 身份。UI 明确选择采用云端设置或把本机设置作为引用两侧 revision 的新设置提交，不能让默认值静默覆盖。默认录入语言/设备身份/连接不共享。换仓库/分支先重新只读确认，清空活动 base 引用，不复用旧 SHA。

## 4. 三方合并

输入 B=已确认 base、L=持久化冻结 working、R=本轮验证 remote。集合 UUID 并集。无 base 的远端新增不会因本机缺少而被删除；有 base 的物理移除是冲突，永不推断删除。

可变记录先检查 id/schemaVersion/createdAt 和词条 lang/origin、卡片 vocabularyId/template 等稳定身份。L=R、L=B、R=B 按确定关系选结果；否则比较明确编辑字段。双方对同字段不同修改保留冲突，不按 updatedAt。en/de 结构对象、dailyNew/reviewEnabled 在已有共同结构时按叶子；普通数组原子比较。contexts 无删除时可逐 ID/text/source 合并；任一端删除既有 context 时按整字段三方比较，不能把删除当新增并集。

合并结果新 revision UUIDv5 根据语义正文和双方父修订确定，保留父因果 ID；时间仅审计。显式决议的新 revision 引用冲突双方，下一轮仍检测新的远端改动。若部分独立字段可合并而其他字段冲突，先保留独立字段和全部候选，停止上传。

ReviewEvent/CaptureEvent/ReviewResolution/Tombstone 是不可变集合：相同 ID 相同负载一次，不同负载是完整性冲突。摄取 ID 单调并集，保留原 capture 检查负载。双端摄取同事件使用既有固定 namespace 97bf633d-3fd0-5afd-9a4b-3f0fe7e44537，派生 entry:<id>、initial-revision:<id>；时间/初始正文来自 capture，不加入设备差异。

墓碑永久并集，旧设备不能复活同 UUID。删除与已编辑活跃副本冲突时保留删除和编辑证据，明确确认保留删除；恢复内容用新 UUID。原词条/卡片历史正文与事件不硬删除。

卡片状态组 fsrsState/stateId/lastReviewEventId/schedulerVersion/settingsVersion 原子处理。沿不可变事件/决议因果可证明后继时采用后继；不同分支冲突，不能逐字段合成。相同词条/模板不同 card UUID 属语义重复，双方停止调度；用户选择一张，另一张软删除并保留历史/墓碑。

## 5. FSRS 分叉与决议

按 (cardId,parentStateId) 检测未忽略兄弟事件，原始事件全部留存，相关卡停止调度。UI 显示评分/时间/设备及完整原事件，用户选择合法分支，追加不可变 ReviewResolution。selectedEventId 是同父根；selectedHeadEventId 是其合法线性终点；ignoredEventIds 记录另一侧根及后继，resolvedState 是终点原 afterState，新的 resultingStateId 独立生成。

卡片指向新决议状态和终点事件；之后评分保存 parentResolutionId，同时 parentReviewEventId 指向终点，parentStateId 指向决议新状态。严格结构与真实 ts-fsrs 回放校验合法桥接。原两评分不会线性重放或平均；忽略事件不计有效学习统计，但仍导出和同步。

选定路径仍有内部未决分叉、并发决议或复杂嵌套无法证明唯一终点时保守停止，保存全部证据，不自动选时间赢家。该边界不意味着普通同父单次或两侧线性多次评分不可用；自动化覆盖分叉、线性后继选择、同步及下一次评分。

## 6. 完整冻结批次、提交和 ACK

syncJobs 持久化 id/schemaVersion/连接 generation、B、L、完整冻结 operations、candidate、expectedSha、createdAt。单纯 UUID/hash 不足恢复，所以保存完整候选。业务写入可继续，不持有 IDB 事务等网络。

1. 事务获取本机租约（90 秒，20 秒心跳），读取或恢复未完成 job，冻结完整输入。
2. 请求并验证私有目标、GET 最新文件/SHA、严格解析/回放验证。
3. 三方合并。冲突时把安全合并正文和候选副本原子留本机，不 PUT、不 ACK，保留 pending。后续本机新修改也再次合并，不能覆盖。
4. 验证完整 candidate，规范化并检查容量，在本机事务持久化 candidate + expectedSha 后才 PUT。
5. 若新 GET 与持久化 candidate 逻辑内容相同，可证明上次含有完整批次最终状态，直接确认，不重发或分配新事件 ID。可变中间操作由本批最终状态覆盖，不表示把每个中间正文作为历史上传；不可变事件均保留。
6. PUT 409 最多三次重新 GET/合并，退避 1 秒、2 秒。重试沿用被冻结操作和确定性合并结果；不是无条件覆盖。
7. 成功后 ACK 单事务：重新核查连接代次和租约；以冻结 L、当前 working、确认 candidate 再合并；写确认 base + SHA；保留后来操作和冲突；只删本 job 捕获的 operation ID；最后删 job。失败全部回滚。

PUT 成功响应丢失、成功后 ACK 失败、刷新/进程重启保留完整 job 和 pending，下次授权后先 GET 核实。远端在丢响应后又变化、无法证明相同 candidate 时重新合并/保守冲突，不凭超时清除 pending。没有最后写入时间胜者。

## 7. 触发、错误与凭证

手动同步；确认授权后同步；可选自动，默认关闭。pending 变化后至少 15 秒合批，尝试间隔至少一分钟；前台、联网、结束学习触发。失败遵循远端限流与指数退避，最多三次自动尝试，然后等待新的人工/前台/联网触发。页面关闭不保证后台上传。

401 清内存授权并停止；403 区分权限与主/次级限流，429 限流，422 普通验证停止/明确 spam 限流退避，404 复核身份，409 有限 CAS 重试，5xx/超时/网络/中断保留不确定提交证据。只显示固定错误文案和分类，不输出 GitHub 私人正文、URL 秘密或请求头。参考 [官方最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)。

PAT 仅目标仓库 Contents 读写，默认仅私有内存，不写 localStorage/sessionStorage/IndexedDB/URL/环境/备份/日志。断开保留本机词库、清凭证和连接；恢复/清除撤销授权。没有前端 OAuth 客户端秘密或记住 Token 功能。CSP、React 文本渲染、无第三方运行脚本与静态 SW 隔离降低暴露面，不能防恶意设备或扩展。

## 8. 备份、规模与未来 Windows

LocalBackup v2 保存 snapshot、metadata/bases/pending/conflicts/preferences，以及连接摘要、完整 jobs 和字段决议审计，无 Token/临时 lease。恢复须备份和确认，拒绝丢历史/墓碑，原子落库后连接和 SHA 清空；原备份任务只供审计，不继承上传。清本机不删除远端。

未来分片需协议升级、不可变内容寻址分片和一个 Git tree/commit 原子指针切换，并验证跨文件引用、迁移回滚和旧客户端拒写。本阶段只单文件，未实现分片、压缩或归档。

Windows 后续只上传按设备/月 CaptureEvent 队列，不修改 FSRS。共享 payload、UUIDv5 和回执接口已准备，本阶段未扫描 captures/、未开发桌面程序或 iOS 原生快捷指令。当前网页 CSV/剪贴板已共用协议。真实远端验收按 [GITHUB_SETUP](GITHUB_SETUP.md)，故障按 [SYNC_TROUBLESHOOTING](SYNC_TROUBLESHOOTING.md)。
