# Polar Vocab 0.6.0 整合发布报告

更新日期：2026-10-27。状态：实现及本地回归完成；源码已普通推送，Actions及Pages部署成功；真实私库端到端与本轮 Windows 跨应用热键性能尚未验收，不能标记整合验收全部通过。

本报告区分代码实现、真实公共 API、Windows 组件测试、模拟 GitHub，以及真实私库请求。历史报告保持原样；本次结果不追溯修改历史验收结论。

## 已实现

- 在现有 Electron/React 程序上增量整合 0.4.1 非激活反馈、异步选区、最新请求取消及 0.5 英德结构化词典；版本为0.6.0，没有新后端、数据库服务或收费Provider。
- 单词、短语、句子自动分类及手动切换；Unicode分词保留原始顺序和标点；原文与中文并列，可点击多个单词分别收藏。网络失败保留原文、编辑与本地收藏。
- MyMemory整句翻译分段处理，最大5000字符/40块，每块最多500 UTF-8字节，并发2；每段来源及失败状态可追踪。部分失败不会悄悄当作完整译文保存。关闭外部查询后可纯手动输入。界面说明只发送所选文本及被请求的词典定义，不读取额外上下文。
- 词典明确的form_of/alt_of关系生成原型候选，不按后缀猜词。自动采用唯一候选仅限无独立义项且未人工修改的当前草稿；歧义由用户选择。保存encounteredForm、lemmaResolution及来源；同句多个词共用稳定上下文ID。句译仅在用户选择且原句未改变时保存。
- EN/DE多词性多义项、IPA、德语冠词/复数/变位沿用原结构与逐字段来源。中文来自独立MyMemory翻译或人工输入，最多自动补4个义项，其余可逐项翻译；不把通用释义复制到每项。不改FSRS算法、事件身份或原始复习记录。
- PAT只在原生遮罩输入框输入，经子进程管道进入主进程；renderer不接收PAT。用户在只读预检后选择记住，由Windows Credential Manager当前用户/本机存储。正常重启恢复、网络故障保留、401清除并要求重新授权、断开忘记。没有明文凭证配置或新OAuth服务端。
- 稳定队列目录：`%APPDATA%/Polar Vocab/Capture`，数据库`captures.sqlite`，设置在SQLite metadata。Chromium运行缓存位于旁边`Capture.runtime`，避免浏览器在首次备份迁移前写缓存干扰安全检查。普通exe无需隔离启动器。
- SQLite user_version=2版本保护、在线一致性备份（包含已提交WAL）、迁移副本验证、发布journal和中断恢复。拒绝原地打开v1、非空目标合并、未知损坏队列重建。备份与旧目录保留，详见[迁移说明](../../docs/INTEGRATED_MIGRATION.md)。
- Web接收protocolVersion1/2；新上下文译文/原词形/原型证明用v2，旧批次不重写。字段编辑、导入、去重与三方冲突处理保留新字段。词形及上下文译文关联作为原子字段处理，避免拼成不一致的释义来源。
- 桌面所有上传路径先检查正式站`release.json`声明兼容v2和context-morphology，未确认时暂停上传但允许本地收藏。元数据5分钟失效重新核对，禁止重定向、无凭证请求。正式站元数据核对通过后可解除上传门槛；这不代替用户当前浏览器的版本更新或真实私库验收。

## 安全迁移的实际结果

审查开始记录HEAD、分支及58项原有未提交修改，另存修改前副本及179项保护文件哈希。没有reset、clean、checkout、删除或重建旧队列。

旧默认`%APPDATA%/Polar Vocab Capture`没有数据库。本次明确选择已审查的现有0.5候选测试目录，只读在线备份后迁入新的正式目录。原库版本1→新库版本2，0事件、0批次；设备身份、设置及逻辑SHA一致，迁移回执与source.sqlite/ROLLBACK.txt已保存。**这是空测试队列的实际迁移，不证明已有大量词库的实际迁移通过。**9项独立迁移回归另用含事件、冻结批次/回执和活跃WAL的人工数据库覆盖数据保留和中断恢复。

179项保护文件均仍存在；176项字节一致。原已活跃0.5队列的主文件/WAL/SHM有物理变化（事先已单独登记为逻辑保护组），事件/批次均0且逻辑SHA与初始记录一致。没有将旧程序指向新版队列。0.4.0/0.4.1/0.5.0程序、全部其他测试目录、PROJECT_PLAN和历史报告保留。没有读取或写入真实私库。

## 实际执行的自动化检查

| 命令/场景 | 结果与边界 |
| --- | --- |
| `npm run check` | 通过：TS、ESLint、Web单元20文件246项、Pages构建、子路径/PWA和源码/构建安全扫描 |
| 最后修改后 `npm run typecheck`、`npm run lint` | 通过 |
| `npm run test:desktop` | Windows正常用户环境10文件72项通过，包含14项授权控制器和9项迁移；Windows沙箱曾出现凭证API权限失败，未当作通过 |
| `npm run desktop:build` | 通过：renderer/main/preload、SelectionHelper、CredentialHelper和来源声明 |
| `npm run test:desktop:e2e -- --reporter list --output reports/test-results/integrated/desktop-regression-2` | 6通过、2默认联网项跳过；真实Windows Electron/SQLite/凭证API和进程重启，GitHub/查询故障部分模拟 |
| `PLAYWRIGHT_CHANNEL=msedge npm run test:e2e -- --reporter list --output reports/test-results/integrated/web-full-20261027-2` | 37通过、3既有移动重复进程测试跳过；桌面对应进程测试通过。手机项目是Chromium仿真，不是iPhone验收；GitHub模拟 |
| `PHASE41_LIVE_DICTIONARY=1 npm run test:desktop:e2e -- --grep 'LIVE public WiktApi' --reporter list --output reports/test-results/integrated/provider-live-final` | 1通过，真实Electron net.fetch访问WiktApi与MyMemory，4个人工词并另验UI查询；没有私库请求 |
| `npm run check:dist` | 通过，含manifest、子路径、离线壳、SW更新、release1/2协议元数据且不缓存release.json |
| `npm run check:secrets` | 通过；实际224项源码/文档及发布清单扫描通过；在没有本地clean filter配置的新克隆中再次扫描通过。无识别凭证、私人数据目录、本机账户路径或个人邮箱 |

E2E覆盖整句译文人工修改、点击persevered/difficulties、原型与原词形保存、上下文ID共用、上下文改动取消句译绑定、切换语言清除旧译文、离线收藏及真正退出重启恢复。授权专门测试使用真实Windows凭证管理器和两次Electron进程启动，覆盖恢复、网络失败、模拟401和忘记；凭证是人工测试字符串，GitHub响应是模拟服务。**不能据此声称真实PAT已自动恢复连接私库。**

初次全Web运行有2项预填译文定位超时及1项浏览器进程超时；严格改用textbox可访问名称后完整重跑通过。首次空目录启动发现Chromium缓存竞态，修复为独立runtime目录后通过。Windows置顶属性回归发现未显式恢复的问题，反馈窗口初始化及触发时明确置顶后通过。旧失败输出都保留。

## 真实公共服务与耗时

WiktApi真实词形查询6/6取得明确关系：persevered→persevere（1702ms）、difficulties→difficulty（1171ms）、went→go及古义wend候选（1071ms）、Häuser→Haus（1128ms）、ging→gehen（1136ms）、gegangen→gehen（1125ms）。这是公共词典网络耗时，不能当作弹窗或UIA耗时。

最后真实Electron查询：perseverance 2784ms（noun，1义项/1中文）；run 3298ms（adj/noun/verb，64义项/4中文，截断及免费额度提示）；Haus 2575ms（das/Häuser，4义项/4中文）；gehen 2598ms（ging/gegangen及明确变位，12义项/4中文）。0.6打包应用真实整句翻译完成1390ms，中文返回成功。

Provider仍为免费WiktApi（Wiktionary/Kaikki，CC-BY-SA来源与署名链接保留）+匿名免费MyMemory（有配额、保留查询/第三方处理可能）。本次没有API Key、收费调用或本地大模型。服务范围、许可与限制见[Provider说明](../../docs/DICTIONARY_PROVIDERS.md)。

## 尚未验证及发布门槛

- **本轮跨应用快捷键实测未通过验收**：记事本工具没有可确认的编辑焦点；Edge控制随后因无法可靠确认当前URL被工具中止。已停止本轮窗口操作，没有绕过策略，也没有用模拟时间冒充200–300ms反馈或1秒取词达标。反馈/读取/词典/翻译分开的结构化计时日志已实现，但本轮没有完整的真实热键样本。
- **真实私库端到端未执行**：本轮不复用聊天里泄露的旧PAT，正式0.6当前未连接。后续只允许人工数据和`Polar0216/polar-vocab-data-test/main`，先备份远端基线再执行上传/接收/去重/复习保留及真实重启恢复；不能覆盖冲突或初始化重建测试仓库。
- 源码提交`2ce4eab0f1588f90236aa06f38d68f299fc043a2`已正常`git push -u origin main`，远端从已核对的c4bee64快进；没有force push。公开[Actions 40423312726](https://github.com/Polar0216/polar-vocab/actions/runs/40423312726)的build和deploy均success，逐步骤公开API核对；没有读取CI原始日志或推测Linux测试精确数量。正式[网站](https://polar0216.github.io/polar-vocab/)和release.json返回200/0.6.0，声明采集与状态协议1/2。线上32文件中31个与本地已测产物字节一致（含接收器、协议和manifest）；sw.js仅预缓存条目跨平台排序不同，排序归一后整个脚本一致，离线壳、SKIP_WAITING及不缓存release.json/GitHub规则均核对。**这是实际HTTPS部署与代码一致性验证，尚未在正式站浏览器执行真实私库v1/v2接收。**
- iOS自动查词与真机验收继续暂缓，不是本次发布阻塞条件。
- Windows10、ARM和SmartScreen签名未验；本次x64应用无代码签名，未更改安全设置。

## 构建产物与启动

新便携版：`artifacts/desktop/integrated-0.6.0/Polar-Vocab-Capture-0.6.0-win-x64.exe`，100606049字节，SHA256：`b6a1bd7df7bc317951914d4693a1621bf48564104169e425967dc8e87640c370`。同目录win-unpacked用于打包内容及正式目录启动验证，内含两个native helper；ASAR版本/主进程/preload及两helper与已测构建字节一致，无队列、备份或识别凭证。压缩便携exe已构建，尚未独立验证其自解压启动；不能把unpacked启动写成SFX启动通过。

正常启动双击新exe即可，不需设置数据目录变量。旧程序应通过托盘退出以释放快捷键；如果仍占用，0.6显示非阻塞提示，可先手动输入或改组合。关闭主窗只隐藏至托盘，退出用托盘“退出”。本机数据不随exe位置改变。

详细文档：[架构](../../docs/ARCHITECTURE.md)、[整句/词形](../../docs/INTEGRATED_TEXT_FLOW.md)、[授权](../../docs/INTEGRATED_AUTH.md)、[迁移/回滚](../../docs/INTEGRATED_MIGRATION.md)。建议清理项目仅包括未来完成验收后的生成测试输出与旧重复包；**本次没有执行清理**。

## 发布记录

源码部署提交为`2ce4eab`；其后仅报告记录提交不改变程序，提交消息以`[skip ci]`避免重复部署相同Web。源码提交的完整CI已通过，报告补记仍执行实际暂存安全扫描。没有发布GitHub Release或上传exe，也没有操作私库历史。浏览器若仍显示旧站，应先应用网站更新；不能用公共能力文件替代旧PWA会话的升级。

## 2026-10-27 桌面授权窗口补充

用户现已恢复网页版配置，桌面实际仍未授权，完整私库验收继续等待。发现0.6.0授权按钮等待但无可见窗，修复版0.6.1及实际验证见[授权窗口修复报告](AUTH_WINDOW_FIX_0_6_1.md)。正式部署网页的独立协议接收测试新增6/6通过，GitHub仍全部模拟拦截，不能视为真实私库验收。
