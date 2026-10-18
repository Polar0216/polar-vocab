# Phase 4 Windows 收词器实施与发布前报告

日期：2026-10-18。范围：Phase4A–4F，本地代码、Windows便携产物、共享采集协议及Web接收；不进入Phase5。**用户已授权公开推送，2e1bf51已普通推送；部署进度见第16节。真实GitHub采集端到端尚未完成，不能标记Phase4全面验收通过。** 下文1–15节保留发布前验收截面，第16节的后续实际结果优先。

## 1. 实际技术栈与项目组织

采用Electron44.9.0、React19.3.0、TypeScript6.0.3、Vite8.3.4、esbuild0.28.2、electron-builder26.15.3。Windows UIA/受保护复制由自有按需C#/.NET Framework4助手实现，不安装Rust/MSVC、AutoHotkey或第三方全局输入库。持久化为内建node:sqlite，非第二套词库/调度器。

新增Electron/builder/esbuild均MIT；@electron/get全局锁定5.1.0以移除旧依赖漏洞链，实际打包验证通过。React/ReactDOM/scheduler/uuid/zod许可证随应用打包，运行时附Electron/Chromium通知。自身源码暂UNLICENSED，未申请付费签名。

```text
apps/desktop/
  src/                  main、preload、IPC契约、SQLite队列、Provider、上传器
  renderer/             查词/收藏、队列、设置与主题
  native/               SelectionHelper.cs（按需运行）
  scripts/              Windows独立构建
  tests/                SQLite/网络故障单元测试及真实Electron集成测试
  electron-builder.json 便携打包配置
packages/shared/        既有模型/UUIDv5重导出、严格批次envelope
src/features/capture/   Web预览与确认接收
src/integrations/github/captures.ts
tests/unit/capture/、tests/e2e/capture.spec.ts
docs/                   使用、架构、协议与故障文档
reports/phase-4/        本报告与公开源码清单
artifacts/desktop/      忽略Git的可执行产物
.cache/phase4-real-*/   忽略Git的隔离验收资料
```

Web和Desktop分别构建，Pages不执行原生打包、不加载Electron代码。原始PROJECT_PLAN及reference未改，历史阶段报告不覆盖。

## 2. 全局快捷键实现

默认Ctrl+Alt+S，设置可换组合；Electron globalShortcut注册失败显示提示，修改失败保留旧配置/注册。单实例、按需读取互斥、托盘打开/退出、关闭隐藏、退出注销快捷键与取消请求均实现。弹窗按鼠标所在显示器workArea裁切，负坐标及小工作区有纯函数测试。

**真实Windows测试：**两个独立Electron进程制造快捷键占用，确认设置失败反馈且原快捷键仍有效；设置切换、退出后重开注册成功通过。快速外部连续触发、多显示器实机尚未验证，不能用模拟坐标替代。

## 3. Windows划词兼容性

UIA TextPattern.GetSelection优先，逐级验证焦点属于当前前台窗口并排除密码字段；超时或无法证明焦点安全时手动回退。复制回退检查剪贴板序列号、所有者、焦点及异步超时；原内容仅空/受支持原始纯文本格式时才模拟Ctrl+C。图片/HTML/RTF/未知格式不复制，不声称无损恢复全格式；不持续监听输入或剪贴板。

| 用例 | 本次结果与证据级别 |
| --- | --- |
| 普通记事本选中example→Ctrl+Alt+S→自动翻译→明确收藏 | **用户真机反馈全部通过**；独立队列查到1条pending、origin=windows、source=windows:Notepad；固定日志有selection-uia |
| 无选区安全回退 | 曾观察selection-manual，但没有完整受控断言，保留为部分观察 |
| 快捷键冲突、设置切换与退出重开 | 真实Windows Electron自动集成通过 |
| Edge/Chrome实际选词捕获 | 未验证；公开示例页已选中example，尚未完成全局触发与结果核对 |
| Word、可复制PDF、VS Code | 未验证 |
| 连续快速触发、旧文本剪贴板、图片/富文本及异步竞争 | 代码保护已实现，外部应用实测未完成 |
| 多显示器、DPI、Windows10 | 几何模拟通过；实际设备未验证 |

computer-use早期应用授权超时，用户未看到提示；随后可打开记事本，但未返回编辑焦点信息，改请用户本人操作。浏览器自动控制又因无法可靠确认当前URL而终止，未继续输入。一次序列化既有记事本状态的诊断被自动审批拒绝，因可能暴露原文档；改为仅检查字段名并新建空白测试标签，没有输出原文档内容。以上限制不升级为应用兼容性通过。

## 4. 翻译供应商及实际调用

已实现可扩展TranslationProvider。当前MyMemory匿名免费GET，无Key、邮箱、付费或语料贡献接口；EN/DE→zh-CN、10秒超时、取消、500 UTF-8字节、响应预算、配额与服务错误保护。界面告知查询原文交供应商处理/可能保留，其他原句字段、标签、PAT不发送。词性/德语词形手动填写，不虚构。

**实际Electron net.fetch/IPC查询通过**（不是模拟）：example→例子，Haus→住宅，gehen→去，Größe→身高，in fact→实际上等候选。另在真实窗口手动修改释义通过，记事本链路自动翻译由用户反馈通过。

真实查询暴露MyMemory首选Haus→mini、das Haus→不相关中文长句的问题。最终适配器优先使用原文/语言精确匹配的中文matches候选，并拒绝无精确中文候选或低匹配结果。修复后Haus实际返回住宅；只能拦截明显异常，中文语义仍需人工核对。初期共享结果JSON曾被供应商复测覆盖，观察值已据工具输出记录；之后结果改用唯一文件名，保留最终真实记录，不把初期共享文件称为完整原始证据。

依据：[API](https://mymemory.translated.net/doc/spec.php)、[配额](https://mymemory.translated.net/doc/usagelimits.php)、[条款](https://mymemory.translated.net/terms-and-conditions)。匿名额度约5,000字符/日，服务可变；没有费用产生。

## 5. 本地队列与数据位置

默认 `%APPDATA%\Polar Vocab Capture\captures.sqlite`，设置显示实际目录。WAL/synchronous FULL、SQLite user_version1，metadata/captures/batches三表。原子保存、稳定草稿UUID、不可变事件、批次冻结、绑定原目标、精确ACK、上传中新增保留、进程中断恢复、搜索/筛选/分页/重试/完整导出均实现。状态为pending/uploading/acknowledged/failed/attention；已确认记录不删除。

真实SQLite事务注入失败/回滚、重开恢复、50事件分批、上传中新增、重试ID不变、导出无凭证测试通过。普通窗口关闭不收藏，Esc隐藏，保存失败保留德语编辑、显式收藏保存及重启恢复有Windows集成测试。

验收覆盖目录为 `.cache/phase4-real-windows/profile/`，用户记事本人工example保留待传；不操作日常AppData队列。`logs/events.log`仅时间和固定分类，无选词/释义/Token。移除便携exe不删AppData，当前没有队列自动恢复导入或清理按钮。

## 6. 兼容既有CaptureEvent

共用原CaptureEvent/VocabularyPayload/Zod，UUID设备/事件、schemaVersion1、en/de、可选原句/释义及结构化德语字段均保持。原固定UUIDv5 namespace、`entry:<id>`、`initial-revision:<id>`规则未改。没有第二套身份算法、词库数据库或FSRS实现；桌面队列不是正式VocabularyEntry。

## 7. GitHub上传批次协议

`polar-vocab-capture-batch / protocolVersion1 / schemaVersion1`；路径 `captures/{deviceId}/{YYYY-MM}/{batchId}.json`。同设备/UTC月、1–50事件、200,000字节，严格版本/未知字段/路径/身份校验。

使用既有GitHubClient私库检查与错误分类，只调用captures能力。新建PUT不带sha，已有同内容返回blobSHA；不同内容拒绝覆盖；409/422重新读取，网络响应丢失保留同一冻结批次供重试。只在原事件集合/正文和回执匹配后原子ACK。手动最多10批/触发，自动尝试至少间隔60秒，连续失败3次暂停。主快照、FSRS、ReviewEvent不由桌面写入。

HTTP适配器的成功、丢响应/重启/同文件确认、碰撞拒绝、401保留队列等**模拟测试通过**；不声称为真实私库API通过。

## 8. Web接收与幂等

生词箱新增「接收桌面生词」：完整tree扫描→所选批次下载校验→预览与语言/词形筛选→相似词提示→明确确认。扫描truncated拒绝，20,000树项/2,000文件/底层2MB响应预算；预览最多20批/500事件/2MB。下载核对blobSHA，确认绑定连接generation。

确认调用既有service.ingest：原事件、派生词条、摄取回执和pending原子写入；默认inbox，无卡片或评分。重复事件跳过、不覆盖之后人工修改，不删除云端批次。正式词库由原Phase3引擎合并/上传，主协议未改版。

10项共享协议/HTTP/摄取单元测试通过；桌面与手机模拟各1项浏览器接收测试通过，验证预览不提前导入、重复回执、保留编辑、待整理及原同步上传，cards/reviewEvents均未新增。正式网站尚未部署此接收入口。

## 9. Token与发布安全

不复用聊天暴露的旧PAT。本阶段尚未输入新的私库凭证，未对真实私库发出请求。PAT仅当前进程/页面内存，预检输入框清空，取消预检/断开/退出清除相应客户端；无记住设备、明文文件、URL、日志或导出Token。

Electron contextIsolation/sandbox开启，Node关闭，受限具名preload、IPC来源与输入校验、自定义本地协议、CSP connect-src none、权限默认拒绝、外部固定官网链接、禁止任意导航/弹窗。Windows选词不是shell命令。真实运行时测试确认渲染器没有require/process能力。

实际asar列出11项（含目录），无识别凭证、SQLite/私库/备份文件，含第三方通知及原生助手。实际公开索引175个文件、清单一致、70个相对文档链接有效，代表性产物/队列/旧验收路径均被Git忽略；clean-only过滤器已核对为仓库本地配置。扫描只覆盖识别模式，不能承诺识别任何私人内容。fresh clone不会继承本地filter配置，仍需每次审查实际索引。不得将私人词库、exe、profile或`.cache`加入源码提交。

## 10. Windows产物

- `artifacts/desktop/Polar-Vocab-Capture-0.4.0-win-x64.exe`
- 100,474,435字节，未签名；SHA256 `f9ffad0c650ee5d049bae7fab3c05b32c76df4faee1055a483c986a7db2da550`。
- `artifacts/desktop/win-unpacked/Polar Vocab Capture.exe` 为解包版本。
- **真实最终便携exe启动、注册快捷键、本地人工收藏通过**；隔离配置1条pending，测试后通过受限quit退出。
- 直接用Playwright Electron启动NSIS外层曾无法附加而超时；改为测试时临时本机CDP验证便携exe自身，实际启动/保存通过。正常使用不启用调试端口、不运行HTTP服务器。此过程不操作外部浏览器/文档。
- 打包初期192px图标被builder拒绝；改用原项目512px资源后成功。未购买证书，不建议全局关闭SmartScreen。

## 11. 实际命令与结果

| 命令/检查 | 实际结果 |
| --- | --- |
| `npm run check` | 通过：Web+Desktop类型检查、Lint、18文件237项Web Vitest、Pages构建、子路径/manifest/SW/秘密模式检查 |
| `npm run test:desktop` | 2文件15项通过，含实际SQLite事务及模拟HTTP/Provider |
| `npm run test:e2e` 初次默认Chromium | 31失败/3跳过，缺Playwright chromium_headless_shell，未进入页面 |
| 设置 `PLAYWRIGHT_CHANNEL=msedge` 后原Web回归 | 31通过/3既有跳过，含离线评分/刷新、进程重开、双端分叉与同步锁；不是iPhone真机 |
| `npx playwright test capture.spec.ts ...`（Edge） | 新增桌面/手机模拟2项通过，人工GitHub响应 |
| `npm run test:desktop:e2e -- --output .../desktop-final --reporter list` | 2项真实Windows Electron集成通过，真实Provider默认跳过；ESM冲突夹具改名后再单独复测1项通过 |
| `PHASE4_LIVE_TRANSLATION=1` + `--grep 'actual MyMemory'` | 1项通过，实际5个词/短语及可编辑窗口；最终精确匹配结果保留唯一文件 |
| `npm run desktop:package` | 最终Windows便携构建通过；原生C#助手、主进程/preload、React与许可证打包 |
| `node .cache/phase4-real-desktop/portable-cdp.mjs` | 实际最终便携exe启动、注册、收藏、退出通过，无私库凭证 |
| `npm audit --json --fetch-retries=0 --fetch-timeout=20000` | 在线审计0个已知漏洞（821项审计依赖计数含平台可选项） |
| `npm ci --dry-run --ignore-scripts --audit=false` | dry-run退出0；Tailwind可选WASM捆绑peer告警，不声称完整干净重装或Linux CI已通过 |
| `.cache/phase4-preservation/inspect-release.mjs` | 40历史文件哈希未变，实际asar识别模式扫描通过；原计划/reference Git差异为空 |
| `git ls-remote origin refs/heads/main` | 只读得到d6665ee，未做远端写入 |
| `npm run check:public-index`、`check-publication.mjs` | 实际175文件索引通过，清单及70个相对链接一致；没有加入exe、SQLite或验收profile |

Windows既有文本保留CRLF；普通 `git diff --check` 将新增行的CR报为尾随空白，使用显式包含 `cr-at-eol` 的临时whitespace配置后检查通过，没有更改历史原件或全局Git配置。

自动输出均在Phase4子目录，真实资料在`.cache/phase4-real-*`，未清理旧验收目录。既有sync.spec的固定截图曾在首次回归重写通用自动截图sync-320.png，现改为testInfo.outputPath避免后续写旧路径；不涉及40份历史基线或真实profile/恢复证据。

## 12. 真实GitHub端到端结果

**尚未验证。** 当前只完成用户记事本→真实翻译→本地CaptureEvent，以及Windows/协议/HTTP模拟和本机Web接收。没有新PAT，未上传真实captures批次；正式站仍是Phase3.5版本，新增接收尚未公开推送。不能称「桌面→私库→正式站→词库→重复读取」全链路通过。

待首次公开报告确认后普通push main、检查Actions/Pages，再由用户在桌面及正式站本人输入新的仅授权`Polar0216/polar-vocab-data-test`受限PAT。保留旧state及学习记录，以人工example/新增人工标记批次验收首次接收、再次读取、编辑保留和原FSRS集合不变。不得清空私库或换用其他私库。

## 13. 尚未完成与保留资料

待：首次公开授权/推送、远端Linux Actions、新正式站接收部署及真实私库端到端；Word/PDF/VS Code/浏览器划词、复杂剪贴板、快速触发、多显示器/Win10实测。用户已暂停iPhone，不再要求测试，原Phase3.5真实401、iPhone同步及正常跨版本SW更新仍保留未验证。

现有测试词条、卡片、事件、墓碑、决议、备份与复现材料保留。40份已有阶段报告/本机恢复证据/控制脚本的SHA256检查无变化；这不是对未哈希浏览器缓存或远端状态的全量证明。此次未对私库请求，更没有删除/重建/覆盖历史。当前不提出执行清理，只给将来用户确认的候选：自动输出、失败工具下载/旧锁副本、重复本机构建、孤立测试profile；历史故障证据与私库不属于默认删除项。

## 14. 技术风险

Electron体积约100MB且未签名；Node SQLite仍experimental；免费翻译记忆可能误译/额度耗尽且会处理查询；UIA及Ctrl+C受应用权限、焦点与剪贴板管理器限制。树扫描及单快照有预算，规模增长需另行版本化设计；不通过删事件规避。关闭窗口留托盘是明确生命周期，退出才结束后台；程序移除不删除AppData。

Pages新版本与Windows10、SmartScreen、低性能机器、外部软件兼容性尚无完整实测；当前客户端仍为手动授权，重开不能自动上传。云端不可变文件只创建、从不清理，长期体积增长需要后续方案。

## 15. 后续建议与停止边界

先完成本阶段发布确认及真实采集链路，修复任何新发现问题，再补Windows兼容矩阵。Phase5可另行授权后设计iOS快捷指令/Numbers收词与更高级词典Provider；不在此轮自动开始，不要求恢复iPhone测试，不清理任何现有环境。

详细使用见 [WINDOWS_CAPTURE](../../docs/WINDOWS_CAPTURE.md)，协议见 [CAPTURE_PROTOCOL](../../docs/CAPTURE_PROTOCOL.md)，故障见 [DESKTOP_TROUBLESHOOTING](../../docs/DESKTOP_TROUBLESHOOTING.md)。

## 16. 授权后的真实发布记录

用户明确授权普通推送及Web部署后，重新核对175文件索引/秘密模式/清单与远端main=d6665ee，通过 `git push -u origin main` 正常更新至2e1bf51，无force、Release或exe上传，未请求真实私库。

首次 [Actions 39112883335](https://github.com/Polar0216/polar-vocab/actions/runs/39112883335) 失败，deploy跳过。已读取真实原始作业日志：Ubuntu24.04、Node24.21.0/npm11.19.0，在npm ci阶段EUSAGE，缺少@emnapi/core/runtime；不是Pages Source问题。旧npm11.6 dry-run遗漏此问题，不能据旧结果宣称跨平台干净安装通过。

在全新隔离目录用CI同版本npm11.19.0重生成复制的锁文件，补回Tailwind WASM实际捆绑的@emnapi/core/runtime1.11.1及peer元数据；直接依赖与Electron版本不变。实际 `npx --yes npm@11.19.0 ci` 成功安装721包，提示两个未覆盖allowScripts的安装脚本与旧依赖弃用告警，未通过放宽安全策略绕过。在线audit仍0已知漏洞，Pages本机构建通过。原锁/错误选摘/完整隔离安装保留在忽略的 `.cache/phase4-publication/`，不清理旧资料。修复后远端CI和正式站结果继续记录，未通过前不标为部署成功。
