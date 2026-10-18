# Windows / Web 采集协议 v1

代码权威：`packages/shared/capture-batch.ts`、`src/domain/vocabulary.ts`、`src/storage/capture.ts`、`src/integrations/github/captures.ts`。这不是主词库快照或本机备份格式。

## 批次 envelope

| 字段 | 约束 |
| --- | --- |
| format | `polar-vocab-capture-batch` |
| protocolVersion / schemaVersion | 均为1，未知版本/字段严格拒绝 |
| id | 批次 UUID，一次冻结后不变 |
| deviceId | 设备 UUID，不使用电脑名 |
| month | 事件 capturedAt 的 UTC `YYYY-MM` |
| events | 1–50个既有 CaptureEvent，同设备、同月、origin=windows，事件ID唯一 |

规范 UTF-8 JSON 最大200,000字节。路径必须与内容身份一致：`captures/{deviceId}/{month}/{id}.json`。上传/重试采用同一 canonicalJson、事件和批次 UUID，不以更新时间或语言偏好派生身份。

CaptureEvent 字段仍为 `id/schemaVersion/deviceId/capturedAt/origin/payload`；payload 复用 `VocabularyPayload`，包含语言en/de、lemma及可选释义、来源、原句、标签、英德结构字段。不上传桌面同步状态、目标连接、Token、卡片、ReviewEvent或FSRS状态。同步状态只属于本机 SQLite 包装。

## 身份与摄取

固定 UUIDv5 namespace 保持 `97bf633d-3fd0-5afd-9a4b-3f0fe7e44537`，条目名称为 `entry:<event.id>`，初始修订为 `initial-revision:<event.id>`；直接复用原实现，不复制算法。Web 默认待整理，不创建卡片。原事件、词条、摄取回执和 pending 由既有 `service.ingest` 原子提交。

同事件ID/同内容重读跳过；同ID/不同内容整次拒绝，不覆盖历史。不同事件ID但拼写相似只提示并默认不选，用户可以明确独立新增。回执随主协议同步，设备更换语言偏好不改变原事件或派生词条身份。重复读取已接收事件不会覆盖之后编辑的释义、标签和词形。

## 创建、冲突与恢复

1. 收藏先提交本机 SQLite 事务。冻结事务持久保存批次原文、目标和事件ID，再发网络请求。
2. 每次验证目标仍为授权私库及有效分支。对固定路径 GET；不存在时再次检查授权，防止将404误判为空仓库。
3. 新建 Contents API PUT 不带 sha，只能创建；存在且内容规范相同则使用该文件 blob SHA 确认，存在不同内容则停止，不覆盖。
4. 409/422 后重新 GET，仅完全相同的文件可确认。网络中断或响应丢失保留原批次；重试先 GET，不生成新批次。
5. 收到合法 SHA 后，本机事务核对冻结正文、全部事件ID及内容，只 ACK 该批次。上传期间新增收藏保留待传。
6. 重启把 interrupted uploading 转为 failed，原批次/目标不变。401模拟测试会撤销授权、保留队列；真实失效PAT尚未验收。磁盘事务失败同样保留待处理记录，不把未提交内容标为已保存。

不可变采集文件使用创建保护，**不是**拿主快照 SHA 更新整个库。主快照仍采用既有 Contents SHA CAS 和三方合并；桌面没有主快照写入操作。

## 扫描与预览预算

Web 先取得分支提交的 tree SHA，再递归 Git Trees；`truncated=true` 明确失败，绝不显示「已完整读取」。最多20,000树条目、2,000采集文件，底层响应另有2MB预算；超出停止，未来需另行设计分页/分片，不能直接删除旧文件规避。

每次预览最多20批、500事件、2MB。列表默认选前10批，用户可调整；下载时复核路径、内容版本、大小、设备/月、事件唯一性及扫描的 blob SHA。远端在扫描后变化则需重新扫描。预览绑定连接 generation，确认前复核授权与目标；用户明确确认后才写 IndexedDB。

## 不清理与未来兼容

本阶段不删除、归档或重命名任何已上传批次；接收状态依靠既有回执。自动测试与真实资料分目录，私库旧词条/卡片/事件/冲突/决议保持。未来 iOS PWA 继续共用事件模型，若扩展允许的批次 origin 或协议字段，须显式版本化并测试旧客户端拒绝，不能裁剪未知字段。

可执行验证：`tests/unit/capture/protocol.test.ts`、`apps/desktop/tests/queue.test.ts`、`tests/e2e/capture.spec.ts`。HTTP故障与幂等用模拟服务器形状；真实私库端到端结果单列在 [Phase 4 报告](../reports/phase-4/PHASE4_REPORT.md)。
