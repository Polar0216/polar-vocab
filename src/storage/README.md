# 本地存储

PolarDatabase 保留 v1/v2 并增量升级 v3，共 17 表，无清库迁移。LocalVocabularyService 负责严格初始化、共享业务事务与 outbox；LocalReviewService 复用同一边界。SyncEngine 只在网络外持有短本机事务，冻结完整批次、SHA 确认和 ACK 保留后来操作。

业务模型在 ../domain；本机偏好/回执在 local-models.ts，连接/批次/租约/审计在 sync-models.ts。凭证没有数据库字段，只在 GitHubClient 内存。完整定义及迁移见 ../../docs/DATA_MODEL.md，恢复与同步边界见 ../../docs/SYNC_DESIGN.md。
