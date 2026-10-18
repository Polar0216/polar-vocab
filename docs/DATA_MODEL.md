# 数据模型与交换协议（Phase 4）

沿用 Phase 0 的六个模型与严格 Zod 校验，Phase 1 接入本地词库、导入和备份，Phase 2 接入真实 FSRS 调度、卡片事务和学习统计；Phase 3 接入 GitHub 合并。以下 1–10 节保留既有记录结构的说明，版本和新增字段以第 11 节为准。所有模型从 `src/domain/index.ts` 导出；schema 使用小驼峰名称，例如 `vocabularyEntrySchema`。本文件以代码为准，规划书中的 Lexeme/StudyCard 在正式协议中分别命名为 VocabularyEntry/Flashcard。

## 1. 通用约定

- `schemaVersion` 固定为数字 `1`，各顶层记录和完整快照均携带它。未知字段和过新版本被严格拒绝，不会通过忽略字段来误写新版数据。
- `UUID` 是 TypeScript 字符串别名；运行时通过 `uuidSchema` 验证 RFC UUID。记录、设备、修订、调度状态、上下文与操作均使用 UUID；词形不是主键。本机创建使用 `crypto.randomUUID()`；采集首次词条及修订使用固定 namespace 的 UUID v5。
- 持久化日期统一为 UTC ISO 8601 字符串，必须以 `Z` 结尾，例如 `2026-10-13T14:00:00.000Z`。导入将带偏移时间显式转换为 UTC；日期值约定为 UTC 零点，无时区的日期时间拒绝。显示时再转换用户时区。
- 空白词形、未知语言、不合法日期、无穷数、不合法引用均拒绝。文本不在 schema 中自动改写大小写、Unicode 或标点；查重单独使用 NFKC、空白和大小写规范化，德语额外比较去除开头冠词的词形，不改写正文。
- 词形/词组最多 500 字符、每条释义最多 4,000、原句最多 20,000、来源最多 2,000、标签最多 80 且最多 100 个。导入另外限制文件 5 MiB、5,000 行、64 列；XLSX ZIP 展开预算见 DEVELOPMENT。
- 可选字段可省略；数组可以为空，但数组中的文本不可全为空白。除明确允许的 `deletedAt`、引用及同步基线外，不用 `null` 代替缺省字段。

可变记录（词条、卡片、设置、删除标记）的通用字段：

| 字段 | 类型/作用 |
| --- | --- |
| `id` | UUID；稳定记录标识 |
| `schemaVersion` | `1`；数据协议版本，独立于 Dexie 数据库版本 |
| `revisionId` | UUID；本次内容修订身份，每次本机更新生成新值 |
| `parentRevisionIds` | UUID 数组；首版为空，普通编辑一个父修订，合并可有多个父修订；不许重复或引用自己 |
| `createdAt` / `updatedAt` | UTC 字符串；用于显示、审计，不能代替因果关系或决定冲突胜负 |
| `deletedAt?` | UTC 字符串或 `null`；软删除时间。完整快照还须保存独立 Tombstone，防止离线旧设备复活数据 |

修订 ID 描述内容因果关系，卡片 `stateId` 描述调度因果关系，GitHub blob SHA 描述文件版本；三者不可混用。Phase 1 已实现 Dexie v1→v2 结构升级，业务 schema 仍为 1；未来业务协议新增版本必须先校验、备份、显式迁移并运行回归测试，失败时保留原始数据。

## 2. VocabularyEntry：词条

| 字段 | 类型/作用 |
| --- | --- |
| 通用字段 | 见上表 |
| `lang` | `en` 或 `de`，判别联合 |
| `lemma` | 必填；保留原始正确大小写和变音字符，冠词单独存储 |
| `meanings?` | 中文义项字符串数组，可完全缺省 |
| `partOfSpeech?` | 词性字符串 |
| `contexts?` | `{id: UUID, text: string, source?: string}[]`；同词条内上下文 ID 唯一 |
| `source?` | 独立来源文本（最多 2,000 字符）；允许没有原句时仅保存来源 |
| `tags?` | 标签数组 |
| `origin` | `manual` / `clipboard` / `ios-csv` / `windows` / `web` |
| `status` | `inbox` 待整理 / `learning` 学习 / `paused` 暂停 / `archived` 归档 |
| `en?` | 只允许英语词条包含的 EnglishFields |
| `de?` | 只允许德语词条包含的 GermanFields |

EnglishFields 可选字段：`phonetic` 音标、`pronunciationUrl` HTTPS 发音资源地址、`collocations` 搭配数组、`inflections` 变形数组、`derivatives` 派生词数组。资源地址仅通过格式及 HTTPS 协议校验，不代表资源存在、可信或已经下载。

GermanFields 可选字段：

| 字段 | 作用 |
| --- | --- |
| `article` | `der` / `die` / `das` |
| `plural` | 复数词形 |
| `infinitive` / `past` / `participleII` | 不定式、过去式、第二分词 |
| `auxiliary` | `haben` / `sein` |
| `separablePrefix` | 可分前缀 |
| `conjugations` | `{tense, person, form}[]`；person 为 `ich`、`du`、`er-sie-es`、`wir`、`ihr`、`sie-Sie` |
| `government` | 格支配数组：`nominative` / `accusative` / `dative` / `genitive` |
| `comparative` / `superlative` | 比较级、最高级 |
| `compoundParts` / `notes` | 复合词拆分数组、备注 |

这些字段只验证结构，不推断德语语法正确性，不自动补词形。最小采集内容为 `lang + lemma`；Phase 1 新建词条默认 inbox，不创建 Flashcard。UI 将 learning 显示为「已整理」，仅表示整理状态。Phase 2 在用户确认后，为含释义的已整理词条创建独立 meaning 卡片。

## 3. Flashcard 与序列化 FSRS 状态

| 字段 | 类型/作用 |
| --- | --- |
| 通用字段 | 见第一节 |
| `vocabularyId` | 被引用词条 UUID |
| `template` | `meaning` / `article` / `reverse` / `spelling`；后三者只预留，初期只创建 meaning |
| `suspended` | 暂停调度；不删除学习历史 |
| `stateId` | 当前调度状态 UUID，跨端评分基线 |
| `lastReviewEventId?` | 最后有效复习事件 UUID 或 `null` |
| `fsrsState` | 完整 SerializedFsrsCard |
| `schedulerVersion` | 包及版本标识，例如 `ts-fsrs@5.4.2` |
| `settingsVersion` | 产生调度状态所用设置修订 UUID |

`SerializedFsrsCard` 直接基于锁定 `ts-fsrs 5.4.2` 的 `Card` 类型定义，只把 `due` 与可选 `last_review` 的 Date 替换为 UTC 字符串。实际字段是 `due`、`stability`、`difficulty`、`elapsed_days`、`scheduled_days`、`learning_steps`、`reps`、`lapses`、`state`、`last_review?`。`state` 为 0 New、1 Learning、2 Review、3 Relearning；计数非负整数，difficulty 范围 0–10，其余数值非负且有限。

库已把 `elapsed_days` 标记弃用但当前协议仍完整保存；升级到移除此字段的版本必须做迁移。Zod schema 被 TypeScript 的实际 Card 类型约束，升级依赖引起字段漂移时需要重新检查；结构 schema 本身不运行算法，实际调度由 FsrsAdapter 执行。参考：[官方 Card 接口](https://open-spaced-repetition.github.io/ts-fsrs/interfaces/Card.html)。

## 4. ReviewEvent 与 ReviewResolution

ReviewEvent 是不可变评分事件；TypeScript 顶层属性为只读，当前评分流程只使用 add 追加写入，已有同 ID 事件只能核对幂等，不进行覆盖。不能在原事件添加或修改 resolution/effective 标记；原始分叉均保留，决议单独追加。schema 校验不负责历史重算。

| ReviewEvent 字段 | 作用 |
| --- | --- |
| `id` / `schemaVersion` | 唯一事件 UUID / `1`；未来按 ID 幂等去重 |
| `cardId` / `deviceId` | 卡片 UUID / 发起设备 UUID |
| `parentStateId` / `resultingStateId` | 评分前父状态 / 评分后新状态 UUID；二者不能相同 |
| `parentReviewEventId?` | 前一个复习事件 UUID 或 `null`，首次可省略；快照校验所属卡片和结果状态引用 |
| `reviewedAt` / `rating` | UTC 时间 / `Again`、`Hard`、`Good`、`Easy` |
| `schedulerVersion` / `settingsVersion` | 使用的 ts-fsrs 版本 / 设置修订 UUID |
| `configuration` | SchedulerConfiguration；不可变配置快照，不只依赖当前设置 |
| `beforeState` / `afterState` | 完整 SerializedFsrsCard；保留原始分支便于审计与后续验证 |

SchedulerConfiguration 包含 `requestRetention`（0–1 开区间）、`maximumInterval`（正整数）、`enableFuzz`、`enableShortTerm`、`weights`（有限数数组）、`learningSteps`、`relearningSteps`（时长字符串数组）。这是完整序列化配置。Phase 2 适配器要求当前版本的 21 项权重，验证学习步骤和参数边界，并拒绝库对旧权重的静默迁移或裁剪；备份恢复还核验事件结果与真实算法一致。默认参数来自 generatorParameters，而非自行猜测。

ReviewResolution 字段：`id`、`schemaVersion`、`conflictId`、`cardId`、`deviceId`、`createdAt`、`parentStateId`、`selectedEventId`、`ignoredEventIds`（非空、不可重复且不能包含 selectedEventId）、`resultingStateId`（新状态 UUID）、`resolvedState`（选定后可用的完整卡片状态）、可选 `reason`。快照校验选中与忽略事件来自同一卡片同一父状态；冲突本身是本机保存的 SyncConflict，其 ID 可在远端审计保留，快照不要求携带全部设备本机冲突副本。

配置与历史设置修订可不同于当前 AppSettings，不能强制旧事件引用当前设置版本。同一卡片两次评分引用同一 `parentStateId` 可以是合法原始分叉，结构校验保留它们；Phase 2 查询会检测同父多事件并阻止该卡继续学习；Phase 3 已实现人工决议和远端合并，因果桥接见第 11 节。

## 5. CaptureEvent：统一采集协议

字段：`id`（即规划书中的 captureId，UUID）、`schemaVersion`、`deviceId`、`capturedAt`、`origin`、`payload`。`payload` 使用 VocabularyPayload，与词条的语言、词形和可选内容字段完全一致，但不含词条生命周期字段；同一 payload 的原句 ID 必须唯一，与正式词条复用相同校验。本机文件及剪贴板导入已共用它，未来 Windows 本地队列继续复用；设备 ID 必须是 UUID，不能用电脑名称。

CaptureEvent 按事件 ID 幂等摄取。`ingestedCaptureIds` 记录已成功转为词条的 ID；同时保留原始 CaptureEvent，以检查同一 ID 不同内容的异常。不得以词形或当前时间临时拼接捕获 ID；重试沿用同一个事件。Phase 4 Windows 队列复用该模型，外层批次见第12节。

## 6. AppSettings 与 SyncMetadata

AppSettings 包含通用可变记录字段、`theme`（light/dark/system）、`dailyNew: {en, de}`（各 0–1,000）、`reviewEnabled: {en, de}`、`desiredRetention`（0–1 开区间）。初始化默认新卡英语 10、德语 5，目标保持率 0.90；模型不会暗中给缺失配置补默认值。主题和语言分类偏好通过服务事务保存到 IndexedDB，并创建 pending；共享设置由 Phase 3 同步，默认录入语言仍只在本机。

SyncMetadata 仅本机使用：

| 字段 | 作用 |
| --- | --- |
| `id` / `schemaVersion` / `deviceId` | 本机元数据 UUID / 版本 / 设备 UUID |
| `status` | unconfigured / idle / pending / syncing / synced / conflict / error |
| `baseSnapshotId` | 最近确认共同基线的 UUID 引用，未同步为 `null` |
| `remoteSha` | 最近确认 GitHub 文件 blob SHA（40 位十六进制），未同步为 `null` |
| `lastSyncedAt` / `updatedAt` | 最近成功同步 UTC 时间或 `null` / 元数据更新 UTC 时间 |
| `lastErrorCode?` | offline / unauthorized / forbidden / rate-limited / sha-conflict / incompatible-schema / invalid-data / unknown；只存错误分类 |

模型不包含 Token、Authorization 请求头或原始网络错误正文；不可将凭证填进任意附加字段。严格字段校验是协议边界，不是检测所有字符串中秘密内容的完整安全系统。凭证的未来内存管理见 SYNC_DESIGN。

## 7. 完整快照与本机协议记录

DataSnapshot（别名 Snapshot）：`id`（快照 UUID）、`schemaVersion`、`exportedAt`、`vocabularies`、`cards`、`reviewEvents`、`captures`、`tombstones`、`reviewResolutions`、`ingestedCaptureIds`、`settings`。以上列表字段均为数组；不是规划书语义样例中的 UUID 字典。数组内记录 ID 唯一，JSON 往返不丢失字段。完整快照不携带 SyncMetadata、PendingOperation、SyncConflict 或 Token，它们是设备本机工作区记录。

快照结构完整性已校验：重复记录/摄取 ID、卡片→词条、复习→卡片、父复习事件→父状态、卡片→末次事件、决议→同父状态分支、摄取 ID→原始 capture。删除关系双向校验：存在 Tombstone 的对象若仍保留正文必须有 deletedAt；带 deletedAt 的词条或卡片必须存在 entityType 与 entityId 均匹配的独立 Tombstone。删除正文可省略，但引用卡片/事件的历史词条和卡片仍须保留软删除正文，历史归档/压缩要另行迁移。不同语言同词形或同语言多义词可以有不同 UUID，schema 不按词形删除所谓重复项。

Tombstone：通用修订字段，加 `entityType`（vocabulary/card）、`entityId`（被删对象 UUID）、`deviceId`，deletedAt 必填。删除记录创建后按 ID 仅追加并保留，两个设备对同一目标独立删除可以生成两个不同 UUID 的标记；任一有效标记均阻止复活。不能通过过期设备缺少某条记录判断删除，也不能自动清除墓碑。

PendingOperation：`id`、`schemaVersion`、`deviceId`、`createdAt`、`baseSnapshotId`，以及 `kind + payload` 判别联合。kind 对应 payload：

| kind | payload |
| --- | --- |
| upsert-vocabulary | VocabularyEntry |
| upsert-card | Flashcard |
| delete-record | Tombstone |
| append-review | ReviewEvent |
| append-capture | CaptureEvent |
| resolve-review | ReviewResolution |
| update-settings | AppSettings |

SyncConflict：`id`、`schemaVersion`、`createdAt`、`entityType`（vocabulary/card/settings/review-event/capture/tombstone/review-resolution）、`entityId`、`kind`（field/delete-vs-edit/review-branch/immutable-id）、`fields`（冲突字段路径）、`base` / `local` / `remote`（相应领域记录或 null）。保留可核查副本；Phase 3 已接入 SyncConflict 的三方写入和决议界面；学习任务已会检测原始复习兄弟分支并阻断调度。

Schema 校验用于导入、数据库事务、备份边界。单个记录 schema 不要求它的引用对象已经存在；完整 DataSnapshot 校验引用，LocalVocabularyService 初始化与写入事务也检查整库完整性。校验失败停止写入、保留原始输入并展示问题，不覆盖工作区。

## 8. 已测试与待测试边界

`tests/unit/domain/models.test.ts` 使用人工协议样例检查最小词条、英德扩展隔离、UUID/日期/版本/文本、严格字段、FSRS 序列化结构、四种评分、不可变事件协议、决议约束、快照引用和去重、删除标记、设置及 Pending/Conflict 类型。

Phase 1 另以 fake-indexeddb 与真实浏览器验证本地持久化、批量导入、事务回滚、备份恢复及 v1 升级 v2。Phase 2 使用真实 ts-fsrs 验证状态转移、原子评分、幂等与本机多标签页保护、日配额、时区/跨日和备份后继续学习。Phase 3 另验证三方合并、API SHA 重试及跨设备分支决议，见阶段报告。

## 9. Phase 1 本地辅助结构与历史备份格式（当前 v2 见第 11 节）

Dexie 数据库升级为 v2，保留 v1 的所有表和记录，新增 `devicePreferences`（id/deviceId/schemaVersion/defaultLanguage/updatedAt）和 `ingestedCaptures`（id/schemaVersion）两张表。所有 ID 仍为 UUID，回执 ID 就是原 CaptureEvent.id。默认录入语言仅属于本机，AppSettings 的主题保存到 IndexedDB 并对应 update-settings 待同步操作。

词条只新增可选 `source`，无此字段的 Phase 0 记录原样可读，业务 schemaVersion 仍为 1。它是向后读取兼容的结构扩展；严格的旧 Phase 0 校验器会拒绝包含 source 的新记录，不能声称新旧客户端完全双向兼容。此前阶段没有远端写入；Phase 3 以独立 protocolVersion 1 统一 source 及决议新字段，旧壳不能写入该 envelope。未知字段/未来版本仍严格拒绝。

本机完整 JSON 使用独立包装 `LocalBackup`，由 backup-service.ts 的 localBackupSchema 校验：

```text
format: "polar-vocab-backup"
backupVersion: 1
schemaVersion: 1
exportedAt: UTC
snapshot: DataSnapshot（包含已删除正文、卡片、复习事件、原始capture和回执ID）
local: {syncMetadata[], syncBases[], pendingOperations[], conflicts[], devicePreferences[]}
```

该包装是灾难恢复格式，不是未来 GitHub 的学习快照；不会把本机 outbox 随远端主快照发送。完整基线与待同步操作保留，Token 没有字段或存储表。恢复保持本机设备 ID，清除确认远端 SHA/base/同步时间并置 unconfigured，后续连接必须重新验证目标仓库；历史事件及 pending 原设备来源不改写。

恢复只支持 replace-local：预览不写入、先保存当前工作区备份，再由用户明确确认替换。预览后任意本机写入会使确认失效；同事件/操作 UUID 不同负载、改变词条/卡片身份、丢失已有永久删除证据均拒绝。此阶段不实现备份合并或多空间；不是简单拼接数组。清除必须有完整备份和两项确认；清表与默认空库重建同事务，失败回滚。

CSV date-only 按明确规则解释为 UTC 当日午夜，带时区 ISO 转 UTC；没有时区的日期时间拒绝。原始大小写用于展示，Unicode NFKC/空白压缩/语言内大小写及德语冠词剥离仅作可疑重复提示，不强制合并。

## 10. Phase 2 调度与统计语义（当前迁移见第 11 节）

没有新增业务字段或数据库表，Dexie v2、schemaVersion 1、backupVersion 1 均保持。Flashcard 的 UUID、vocabularyId、template、创建时间稳定；同词条同模板只保留一个未删除卡片，暂停卡片也占用此模板。数据库索引保留历史重复的能力，唯一活动模板由跨标签页串行 rw 事务检查；不使用会禁止删除历史并存的全表唯一索引。

FSRS state 沿用库定义：0 New、1 Learning、2 Review、3 Relearning，suspended 是独立管理状态。仅 meaning 模板进入当前任务。创建前须已整理、未删除并有释义，确认数值后原子保存；词条编辑不重置卡片。

适配层使用 `createEmptyCard`、`generatorParameters`、`next`，序列化所有 Card 字段。默认保持率 0.90、maximumInterval 36,500、fuzz=false、shortTerm=true，默认学习步骤 1m/10m、重学 10m 和 21 项权重均取自锁定包。AppSettings 既有结构继续允许合法旧值；设置界面及更新服务对新保持率输入限制 0.70–0.99。修改只作用于下一次评分，当前 due 与历史参数快照不改写。

一次 GradeCommand 使用稳定 eventId、cardId、expectedRevisionId、expectedStateId 和 rating。服务器时间不存在，reviewedAt 取设备当前绝对时间并以 UTC 保存；未到期或时间早于上次评分拒绝。适配结果写入完整 beforeState/afterState、配置、算法版本、父事件/父状态和新 stateId，同时更新卡片 revision、末次事件和两条 pending。任一写入失败回滚，同 ID 不同操作拒绝，同 ID 同操作返回原事件；不同 ID 基于旧状态提交也拒绝。

每日任务从快照推导，不另存容易漂移的每日计数或 React 队列。日期键使用设备当前 IANA 时区的本地年/月/日；最近七天是七个日历日期，不是固定 24 小时时窗。原事件不增加时区字段，旅行或切换时区会重新归属当地日期，due 仍是同一绝对时刻。界面显示当前时区。

- 总词汇数：未删除独立 VocabularyEntry 数，包括待整理与归档。
- 总卡片数：未删除卡片；活动数排除 suspended、未整理/归档词条、无释义、未知算法/不支持模板及兄弟分支。语言偏好决定是否参与任务，不重写卡片管理状态。
- 现在到期：活动且启用语言的非 New 卡片 `due <= now`，包含此前逾期；分开显示 Review 和 Learning/Relearning。
- 今日新学习：当地今天 beforeState.state=New 的独立 cardId 数；同卡再次评分不重复扣新额度。
- 可学新卡：启用语言的有效 New 卡按创建时间截取 `max(0, dailyNew - 今日已新学)`；到期旧卡优先且不受新额度限制。
- 今日评分/近七天次数：有效 ReviewEvent 数；独立卡片数按 cardId 去重。已删/暂停卡片的过去事件仍计入历史，不能从今天任务排除就丢掉过去记录。已决议 ignoredEventIds 不计有效次数，原始事件仍保存。

恢复除原结构校验外，会核验当前卡片状态、事件链、真实 FSRS 回放结果及唯一活动模板。不自动升级旧权重、不修复未知算法或缺失事件。旧 Phase 1 无学习记录备份可恢复到不丢失当前历史的工作区；缺少本机已有 ReviewEvent/ReviewResolution 的旧备份拒绝覆盖。存在后续评分的非终点状态不能被选作当前状态。显式本机全量清除仍要求完整备份和双重确认，不等于远端删除或常规学习历史重置。

## 11. Phase 3 当前协议与迁移（优先于前述历史阶段状态）

业务 schemaVersion 仍为 1；云端首次正式发布 **format=polar-vocab-state / protocolVersion=1**，严格拒绝未知字段与未来版本。Phase 0～2 没有实际云端协议写入功能，不能让旧代码写入新 envelope。source 已纳入协议1；旧记录省略它仍可读，不通过裁剪未知字段兼容旧客户端。

ReviewEvent 新增可选 **parentResolutionId: UUID**。普通旧事件省略；决议后的事件必须同时引用合法决议、新父 stateId 和选定终点事件。ReviewResolution 新增可选 **selectedHeadEventId: UUID**，表示选定分支的合法终点；selectedEventId 保留同父根事件，忽略列表可包含另一分支的后继。结构校验检查根/终点/忽略事件的因果归属，算法核验检查 resolvedState 等于选定终点 afterState、参数回放和不可回退。旧无 head 字段决议按 selectedEventId 作为终点读取；没有合成或改写旧原始评分。

```text
GitHub data/state.json:
{format: polar-vocab-state, protocolVersion: 1, schemaVersion: 1,
 snapshotId: UUID, snapshot: DataSnapshot}
```

snapshotId 必须等于 snapshot.id。完整共享集合按 UUID 字典序，摄取回执按 UUID 排序，对象字段按 Unicode 编码顺序；meanings/tags 等业务数组保留顺序。序列化不分配时间或随机 ID，同逻辑快照往返稳定；比较 working 时排除临时快照 id/exportedAt。合并修订 UUIDv5 由语义正文与候选父修订确定，不按时间选择胜者。

共享：词条、卡片、评分、捕获、永久墓碑、ReviewResolution、摄取 ID、AppSettings（主题、每日额度、保持率、语言任务偏好）。本机：默认录入语言、设备 UUID、Token、pending、连接、网络状态、同步基线、锁、批次及字段冲突副本。Token 没有任何持久化字段。

Dexie **v3 / 17 表**：原 v1/v2 保留，新增以下表，无数据清空迁移：

| 表 | 严格字段及用途 |
| --- | --- |
| connections | UUID/schemaVersion、owner/repository/branch/path、auto、authorized（本机状态提示而非凭证）、retryAt、generation UUID。重新加载内存无凭证时须重新授权。 |
| syncJobs | UUID/schemaVersion、generation、base/null、完整 local、冻结 operations、candidate/null、expectedSha/null、createdAt。保存上传意图与恢复证据。 |
| syncLeases | 固定 UUID 键、schemaVersion、holder UUID、expiresAt 数字。设备本机串行和崩溃过期，不共享。 |
| conflictDecisions | UUID/schemaVersion、完整原 SyncConflict、副本选择类型、createdAt。本机审计，随完整备份导出。FSRS 的共享审计另外是 ReviewResolution。 |

LocalBackup 现在导出 **backupVersion=2**，其 local 在原五集合之外加入 connections、syncJobs、conflictDecisions；不会包含 Token，临时租约不备份。旧 v1 包装先验证不含新字段，再显式增加这三个空集合并升包装版本，业务行不改写，随后完整结构/FSRS 核验。严格旧客户端会拒绝 v2，不能声称双向兼容。

恢复完整保留共享历史、墓碑、冲突和字段决议审计，保留当前 deviceId，重置已确认 SHA/base/连接授权；旧任务仅在原备份保留供审计，不恢复活动上传。缺记录不是删除，重新连接要再次验证。换仓库不得沿用旧 base。备份预览绑定工作区指纹；恢复失败整体回滚。

单快照 **720,000 UTF-8 字节预警 / 900,000 上限**，单文件不是无限容量数据库。上限不改变本地/20 MiB 完整备份的保存能力，不裁剪事件。未来规模迁移需新 protocolVersion、不可变分片及单次 Git tree commit 原子索引切换，当前只设计。

## 12. Phase 4 采集包装与桌面存储

`packages/shared/` 直接重导出既有模型与 UUIDv5 实现，新增的 `CaptureBatch` 仅是 `format/protocolVersion/schemaVersion/id/deviceId/month/events` 严格包装；详细预算、路径和不可变语义见 [CAPTURE_PROTOCOL](CAPTURE_PROTOCOL.md)。不修改 `DataSnapshot`、主快照协议或FSRS字段，不需要Dexie升级。

桌面 SQLite `user_version=1`，`metadata` 保存设备UUID、DesktopSettings及无Token的目标三元组；`captures` 保存不可变事件JSON、时间、状态、batch_id、固定错误码；`batches` 保存规范正文、原目标、状态、SHA及固定错误码。状态包装不会写进远端CaptureEvent。WAL、synchronous FULL、本地保存/冻结/精确ACK事务；上传中新增事件不加入旧批次。未来版本或损坏记录拒绝并保留原文件，不清空迁移。

DesktopSettings 只含快捷键、默认语言、主题、复制回退、自动查词和自动上传开关；与 Web AppSettings 分开，不同步学习配额。默认自动上传关闭。不存在Token字段或「记住此设备」。队列导出是 `polar-vocab-desktop-queue / queueVersion=1`，用于保留采集/outbox证据，不是Web LocalBackup；当前不提供导出文件的自动恢复入口。
