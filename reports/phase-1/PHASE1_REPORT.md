# Polar Vocab — Phase 1 实施与验收报告

验收日期：2026-10-14。工作区：`<project-root>`。在 Phase 0 工程上继续开发，没有重建工程、初始化 Git、创建远程仓库、推送或部署。本阶段完成后停止，未进入 Phase 2。

## 1. 实际完成的功能

**已经实现：**

- 生词箱快速收词：仅词形与 en/de 即可保存；释义、原句、来源、标签选填，默认待整理。
- 词库查询和管理：词形/释义/原句搜索，语言/标签/状态筛选，创建时间与字母排序，分页，详情编辑，批量标签及状态、归档、软删除。
- 英语搭配、变形、派生词等选填；德语冠词、复数、主要动词词形、人称变位、格支配等结构化选填，按语言及词性展开。
- 语言内重复建议：NFKC、大小写、空白和德语开头冠词比较；保留原词。手动重复可取消、查看已有或明确另存；导入默认跳过、可只补空字段。
- CSV/TXT/XLSX 本机解析、列映射、工作表选择、默认语言、错误物理行号、有效/无效/重复计数、确认后的原子导入。
- 用户点击触发剪贴板读取；单词、短语、多行及 Tab 表格进入预览；失败时可手动粘贴，确认前不入库。
- 全部、英语、德语和当前筛选 CSV 导出；完整 JSON 备份、校验预览、确认覆盖恢复；清除前备份和双重确认。
- 首页真实本机计数与最近词条，设置中的默认语言、语言分类偏好、主题、存储估算与持久存储申请。
- IndexedDB 持久化；所有业务修改与 pending 在同一事务；失败不报成功，编辑 CAS 防止覆盖更新，保留删除证据和原始采集事件。
- 延续桌面侧栏、手机底部导航、中文界面、键盘与焦点处理、PWA 静态离线外壳。

「已整理」对应既有 `learning` 状态，仅表示整理完成。本阶段新增词条不会生成卡片，也没有虚构复习次数或远端同步成功状态。

## 2. 主要新增和修改的文件

| 位置 | 职责 |
| --- | --- |
| `src/features/vocabulary/service.ts`、`query.ts` | 唯一本机业务服务、事务、查重和查询 |
| `src/storage/database.ts`、`local-models.ts`、`capture.ts` | v1/v2 表结构、本机偏好/回执、稳定采集 UUID |
| `src/domain/vocabulary.ts` | 沿用共享模型，增加可选独立来源字段 |
| `src/app/VocabularyProvider.tsx`、`vocabulary-context.ts` | 初始化及 Dexie liveQuery 页面状态 |
| `src/features/vocabulary/QuickAdd.tsx`、`EntryEditor.tsx`、`VocabularyManager.tsx` | 收词、完整编辑、筛选和批量管理 |
| `src/features/vocabulary/ImportPanel.tsx`、`ImportPreviewView.tsx` | 文件/剪贴板预览与明确提交 |
| `src/features/import-export/import-service.ts`、`export-service.ts`、`backup-service.ts`、`limits.ts` | 解析边界、导出、完整备份和恢复 |
| `src/integrations/clipboard/adapter.ts`、`preview.ts` | 权限错误分类、文本清理与预览 |
| `src/features/home/`、`inbox/`、`settings/`；`src/components/Dialog.tsx`、`Feedback.tsx` | 页面真实数据、确认流程与反馈 |
| `tests/unit/storage/`、`import-export/`、`clipboard/`；`tests/integration/vocabulary-ui.test.tsx`；`tests/e2e/vocabulary.spec.ts` | 数据故障、交互及真实浏览器测试 |
| `package.json`、`package-lock.json` | 依赖精确版本与完整锁文件 |
| `README.md`、`docs/ARCHITECTURE.md`、`DATA_MODEL.md`、`SYNC_DESIGN.md`、`DEVELOPMENT.md` | 当前实现、协议兼容、测试和使用说明 |

目录继续分开管理：`src/`、`public/`、`tests/`、`scripts/` 与根目录配置是工程；`docs/` 是需求与设计，`docs/reference/` 是原始资料；`reports/phase-0/` 与 `reports/phase-1/` 是阶段报告。自动浏览器产物位于 `reports/test-results/` 和 `reports/playwright-report/`，与 `dist/`、`node_modules/` 一样不提交。

原始规划书和 `docs/PROJECT_PLAN.md` 的 SHA256 均保持：

```text
65FF8BA7FADC81A7EBDB8352D7824D012144CCCD986E2294F141D39442FD45AA
```

Phase 0 报告作为历史记录保留，没有改写为 Phase 1 验收。

## 3. 数据库结构及数据迁移

Dexie 数据库升级为 **v2、13 张表**。保留 `version(1)` 和原 11 张表，v2 仅新增：

| 表 | 内容 |
| --- | --- |
| `devicePreferences` | UUID、schemaVersion、设备 UUID、默认录入语言、更新时间；本机偏好 |
| `ingestedCaptures` | 原 CaptureEvent UUID、schemaVersion；成功摄取回执 |

v1→v2 升级不清库、不重写原业务记录，自动化测试验证旧词条、卡片、设置和 pending 保留。业务协议 `schemaVersion` 仍为 1，独立于 Dexie 版本。

词条新增可选 `source`，无来源的旧记录可直接读取；严格 Phase 0 客户端会拒绝新字段。这是新客户端读取旧数据的兼容扩展，**不代表新旧客户端双向兼容**。当前没有真实远端数据；Phase 3 联通前需统一客户端版本并决定正式 schema 升级和迁移。

初始化及写入前后校验所有记录与完整快照引用。词条编辑生成 revision 并记录父 revision；保存时校验期望 revision。删除保留正文、Tombstone、相关 pending，并暂停/软删除已有卡片，保留复习事件。纯采集不创建卡片。

CaptureEvent 原负载不可变。固定 namespace `97bf633d-3fd0-5afd-9a4b-3f0fe7e44537` 派生 `entry:<capture-id>`、`initial-revision:<capture-id>`；固定向量、重复摄取和故障回滚已测。批次行 UUID 在预览内稳定，重复提交以事件和回执去重。

## 4. CSV / TXT / XLSX 导入

| 格式 | 当前实现 |
| --- | --- |
| CSV | PapaParse 处理 UTF-8/BOM、CRLF/LF、引号、逗号、双引号、多行、分隔符；标准列 `word,lang,meaning,context,source,tags,created_at` 可映射、非必要列可缺省 |
| TXT | 每个非空行是一条词或短语，统一默认语言；不按空格拆短语 |
| XLSX | read-excel-file universal 入口惰性加载、本机只读、多工作表；保留文件物理行信息；已格式化日期转 UTC；不执行公式 |

导入前限制 **5 MiB、5,000 行、64 列**；XLSX 限制 256 ZIP 条目、实际总展开 20 MiB、单条目 10 MiB，并拒绝加密/ZIP64、危险或重复路径、异常范围、超大稀疏行列和解压预算超限。文件扩展名/MIME、UTF-8、字段、语言和日期经过检查，超限拒绝整个文件。`.numbers` 提示先导出 CSV。

日期值约定 UTC 零点，带偏移的 ISO 时间明确转换；无时区日期时间及不能可靠识别的 Excel 数字日期拒绝。错误显示输入物理行号，支持用户修改映射或默认语言后重新预览。

解析和取消不写词库。确认时重新按当前数据库查重，并把词条、原始捕获、回执和每条 pending 在同一事务提交，中途失败全部回滚。默认重复跳过；补空模式不覆盖非空数组或标量；另存需要明确选择。预览展示前 100 条有效记录，剩余重复默认跳过，计数和提交涵盖全部有效行。

本阶段新增依赖全部 MIT，精确锁定：PapaParse **5.7.0**、read-excel-file **9.3.12**、fflate **0.8.3**、uuid **14.0.3**，开发类型 `@types/papaparse` **5.5.2**。既有 React/TypeScript/Vite/Dexie 等基线保留，完整版本与许可表见 [DEVELOPMENT](../../docs/DEVELOPMENT.md)。官方解析说明：[PapaParse](https://www.papaparse.com/docs)、[read-excel-file](https://github.com/catamphetamine/read-excel-file)。

## 5. iOS 剪贴板兼容策略

Clipboard API 只在「从剪贴板导入」点击处理器中直接调用，不在加载、聚焦或后台自动读取。要求 HTTPS/localhost 安全上下文；不支持、拒绝、空内容及其他失败均显示反馈并保留手动文本输入。单词与短语不拆空格，多行/Tab 表格走批量预览，保存前用户确认语言和内容。

单元测试覆盖成功、拒绝、缺少 API、空内容、德语字符、短语、多行/TSV；真实 Chromium 浏览器通过权限拒绝模拟验证点击次数、手动粘贴和确认前无写入。**尚未验证真实 iPhone Safari、系统剪贴板授权提示和主屏幕 PWA。** 移动测试是 iPhone 尺寸的 Edge/Chromium 模拟。

手动验收：在已授权部署的 HTTPS 站点复制英语词、`Grüße`、短语及多行/Tab 文本，分别用 Safari 和主屏幕 PWA 主动读取；检查预览和语言、取消无写入、确认后刷新仍在；拒绝权限后长按文本框粘贴，输入不得消失。随后断网添加、刷新并重新打开，检查持久性。完整步骤见 [DEVELOPMENT 第 7 节](../../docs/DEVELOPMENT.md)。

## 6. JSON 备份与恢复方案

完整 JSON 使用 `LocalBackup` 包装：`format=polar-vocab-backup`、`backupVersion=1`、`schemaVersion=1`、导出时间、DataSnapshot，以及本机 metadata、完整 syncBases、pending、conflicts、devicePreferences。包含现存卡片、复习/采集/决议事件、设置及墓碑；没有凭证字段。CSV 为 UTF-8 BOM，正确转义并防护电子表格公式注入，不能替代完整 JSON。

恢复只实现 **replace-local**，不提供猜测迁移、数组拼接合并或多空间。最大 20 MiB，严格验证版本、字段、唯一 ID、引用、删除证据及不可变事件/操作内容。预览只读，内部保存独立的恢复计划；用户改动预览对象不能改变计划。确认绑定当前数据库状态，其他页面修改后拒绝旧预览。

覆盖前必须下载当前完整备份并勾选确认；清除还须输入指定确认文字。浏览器下载触发不能证明操作系统已保存文件，界面要求用户确认已保存。替换/清除均在单一事务中执行并验证结果，失败保留原数据；清除后的默认设置也在同事务建立，回滚后恢复正常页面读取。

旧备份若缺少本机已有墓碑、改变同 ID 事件/操作或词条/卡片稳定身份，会被拒绝，避免已删词复活。恢复保留当前设备身份，重置已确认远端 SHA/base/同步时间为未配置，历史本机基线和操作保留；不能继承授权或把备份 SHA 当作当前远端版本。明确清除仅重置本机工作区，不向远端发送删除。

## 7. 实际测试与结果

环境：Windows、Node **24.13.0**、npm **11.6.2**、已安装 Microsoft Edge。受限沙箱不能绑定回环端口，浏览器测试使用环境批准的本机进程/loopback 权限，未调用外部词库服务。

| 实际命令 | 最终结果 |
| --- | --- |
| `npm run typecheck` | 通过，应用与工具配置 TypeScript 无错误 |
| `npm run lint` | 通过，0 warnings |
| `npm test` | 9 个文件、**144 项通过** |
| `npm run check` | 类型、lint、测试、Pages 构建、产物与公开树串行检查全部通过 |
| `npm run build:pages` | `/polar-vocab/` 产物成功；存在大 JS chunk 提示，见风险 |
| `npm run check:dist` | HTML 资产、manifest、PNG 尺寸、SW 注册/作用域和离线外壳检查通过 |
| `npm run check:secrets` | 常见凭证模式与私人数据目录检查通过；手写报告和 dist 在检查范围 |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e` | **15 项通过、1 项有意跳过、0 失败** |
| `npm audit --json`；`npm audit --omit=dev --json` | 均 **0 个已知漏洞** |
| `Get-FileHash -Algorithm SHA256`（两份规划书） | 与 Phase 0 记录完全一致 |

144 项包括模型 49、数据库结构 1、词库事务 32、文件/CSV/剪贴板 34、备份恢复 14、页面交互 14。保留 Phase 0 导航/模型/数据库/PWA 测试目的，数据库断言随真实 v2 升级。

测试覆盖 v1 迁移、未知 schema/非法引用、CAS、数据+pending 故障回滚、删除与已有卡片历史、采集冲突/幂等、正常和 Numbers 风格/BOM/引号多行 CSV、TXT、真实 XLSX 及压缩预算、字段/语言/重复错误、取消/中途失败、剪贴板成功及回退、备份完整往返、未知版本、重复恢复、不可变身份、旧删除备份拒绝、恢复/清除失败、未知摄取回执拒绝。

浏览器通过真实页面操作验证五路由、主题、录入及德语编辑、筛选、CSV 预览取消/补空、离线首次加载 XLSX 解析、离线新增/刷新、关闭页面与重开、浏览器进程关闭后同一隔离 profile 重开、JSON 文件下载/清除/恢复、SW 及 manifest 子路径。浏览器重启场景只在桌面执行，手机项目的相同重启场景有意跳过；不是 Safari 测试缺失的替代结论。

320px 五页面与已填写编辑弹窗通过无横向溢出断言；人工检查桌面词库、手机首页及编辑截图。截图、HTML 报告分别在 `reports/test-results/`、`reports/playwright-report/`。Pages 工作流保留 main 发布/PR 只验证，远端执行尚未发生。

## 8. 尚未实现或无法验证

**已设计但未实现：** GitHub Contents SHA CAS、三方合并、远端 ACK/lease/attempt、跨端同步、Token 授权，沿用 [SYNC_DESIGN](../../docs/SYNC_DESIGN.md)。本机 pending 存在不代表远端已同步。

**本阶段未开发：** FSRS 调度、正式复习/创建卡片、Windows 划词程序、iOS 原生快捷指令/Numbers 文件、AI 翻译、词典 API、账户系统、JSON 合并恢复及多工作区。

**尚未验证：** 真 iPhone Safari/PWA 剪贴板与存储、系统安装菜单、SW 真实发布更新与多标签页升级、GitHub Actions 云端执行和线上 Pages。没有远程仓库，未推送或部署；本地子路径构建和离线浏览器验收已完成。

## 9. 技术债与风险

- 主 JS 约 **578.28 kB、gzip 181.88 kB**，Vite 提示超过 500 kB；构建通过，没有抬高阈值掩盖提示。XLSX 已惰性加载，后续可进一步分离页面/模型代码。
- 查询和每次写入完整引用校验仍扫描本机记录；导入查重已建立映射避免逐行全库二次扫描。5,000 行测试不等于所有低性能手机性能已验收。
- SW 静态预缓存含惰性解析资产，约 **682.18 KiB、15 项**。首次未缓存离线不能打开，真实发布升级仍待验证。
- IndexedDB 仍受用户清理、私密模式和系统回收影响。持久存储申请不能代替离线备份；JSON 的 20 MiB 接收上限是当前恢复边界，更大数据集需后续格式/分片方案。
- source 的业务 schema 兼容限制需在首次多端发布前统一处理。禁止旧客户端忽略新字段写回。
- 替换恢复为安全保留本机删除证据会拒绝某些旧备份；当前不提供自动合并或复活。报告和界面明确提示，原库保持不变。
- read-excel-file 不计算公式，读取缓存值；过时或无缓存公式可能缺值。未保存格式的数字日期不猜测，要求用户使用可识别日期/CSV。
- 审计 0 漏洞与凭证扫描通过只描述当前公告和检测范围；公开内容只有人工夹具，不存在生产词库种子。传递构建库弃用提示和第三方声明仍需在后续升级维护。

## 10. Phase 2 建议

仅作为下一阶段建议，未执行：

1. 为已整理词条提供明确的卡片创建流程，默认 meaning 模板；保持词条身份和卡片状态分离。
2. 适配锁定 ts-fsrs：序列化/反序列化、配置合法性、评分结果、时区与 due 查询，验证实际 API 和调度边界。
3. 评分时把卡片状态、唯一 ReviewEvent、revision/stateId 和 pending 同事务提交；失败回滚，保留既有历史。
4. 实现待复习列表及真实统计，验证刷新、离线、重复点击、多标签页基线冲突，继续保留原始事件。
5. 在真实 iPhone 上先执行本阶段手动清单，再优化复习输入与缓存更新交互。GitHub 同步继续留在 Phase 3。
