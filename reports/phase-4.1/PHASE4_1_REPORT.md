# Phase 4.1 — Polar Vocab Capture 0.5.0 英德词典与结构化义项

日期：2026-10-26。基于既有 Phase4 与未提交的0.4.1快捷键修复继续增量开发，没有重写项目。本次只交付本地词典/义项升级和配套Web兼容代码；未提交、推送、部署网站、发布GitHub Release、操作真实私库或执行iOS验收。

## 1. 已经实现

- 英语、德语词典查询；词性属于单个义项，一个词可有多个词性，同一词性可有多个义项。
- 义项独立保存稳定UUID、中文、词典原文及其语言、可选例句及译文语言、逐字段来源；保留可用IPA和明确词形。
- 桌面改为义项列表，支持手动修改、新增、删除，以及按义项补充中文翻译。查询进度先展示词典，再异步补中文；失败不关闭窗口、不覆盖人工编辑。短语回退候选不指定名词/动词。
- 重复查询按义项ID归并，人工改写与已删除候选优先保留；收藏时取消未完成查询，冻结当前所选义项。重复保存同一草稿保持原事件ID，新词代表新的主动采集。
- 德语名词冠词/复数、动词原形/过去式/第二分词/常见现在时变位/助动词从明确标签读取。缺失或歧义留空，原始词形列表可查看；现有德语字段可人工核对修改。
- 继续使用SQLite队列、不可变采集批次、GitHub Contents上传适配及Web导入入口。Web预览、词库和编辑器支持完整义项，编辑后重新生成旧复习界面的中文投影。
- 保留0.4.1非激活反馈、异步读取、连续触发管理与不记录选词内容的性能日志。未改FSRS算法、卡片或ReviewEvent结构。

## 2. 实际采用的Provider、许可和费用

词典：**WiktApi**，数据链为 Wiktionary贡献者 → Kaikki提取 → WiktApi公开API。使用英语Wiktionary版，分别限定词语语言en/de，因此德语词的原文定义通常是英语。真实完整word端点缺少顶层POS，本实现使用官方definitions/forms/pronunciations三个端点，避免从定义或词尾猜词性。

服务公开免费、免Key；未发现固定免费速率额度或SLA承诺，不能承诺永远不限流。词典文字采用CC-BY-SA-4.0，保留词条链接、许可和人工修改标记；Kaikki也说明CC-BY-SA/GFDL来源。仅复制无文献引用的使用例句，不自动复制书籍quotation，不下载或打包有独立许可的音频。可用IPA保留。

中文：**MyMemory / Translated**，单独翻译每个义项的英文定义，不把一个单词的通用中译贴到所有义项。匿名免费额度官方为5,000字符/日，单次500 UTF-8字节；不传email、Key，不调用set/import或付费方案。自动最多4义项、自动翻译并发最多2；其他义项可手动点翻译或填写。进程内最多缓存100条定义译文，减少重复耗量。

初次真实测试发现MyMemory把机器翻译标为MT!且match=0.85，旧代码按0.99过滤导致中文留空。已修正为：完整原文及语言匹配的高匹配候选，或明确MT!的相同原文候选可用；相近句子的模糊中文继续拒绝。自动/手动修改仍需要核对，不将翻译候选标成词典原生中文。

Wiktionary原文许可与MyMemory候选条款分开，软件UNLICENSED不取代数据许可。MyMemory不是统一许可的开放数据集，不承诺可把所有译文批量公开再分发；本功能只做个人逐词查询，不爬库。查询可能被服务保留并由合作方处理；单独填写的原句、标签、队列和Token不发送给Provider。

评估还包括Free Dictionary API、Kaikki原始JSONL和PONS。前者官方英语接口明确，但未验证满足德语词形；Kaikki整库需要额外大型索引/更新；PONS需X-Secret且费用/授权须确认。因此均未额外接入。详细对照和官方链接见 [DICTIONARY_PROVIDERS](../../docs/DICTIONARY_PROVIDERS.md)。没有开通收费服务或新增npm依赖。

## 3. 模型、身份和兼容策略

新增可选payload.lexicon / VocabularyEntry.lexicon，严格schema见 src/domain/lexicon.ts：

| 部分 | 数据 |
| --- | --- |
| lexicon | schemaVersion=1、senses、phonetic、forms、fieldSources、removedSenseIds |
| sense | UUID、partOfSpeech、chinese、definition、definitionLanguage、examples、sources |
| example | UUID、text、可选translation/translationLanguage、来源 |
| form | UUID、form、partOfSpeech、原始tags、source |
| source | wiktionary/mymemory/manual/legacy、可选HTTPS URL、license、modified |

词典义项UUIDv5使用独立namespace f7605af7-ce04-58fc-904d-1328c445d779，名称包含Provider/edition/语言/NFC原词/词性/原文定义，不包含中文、时间、请求ID或排序。人工新增用UUIDv4，编辑不换ID。上游原定义改变会产生新候选ID，不能声称跨上游改写也已完成语义身份识别。原候选和人工修改不被静默覆盖。

meanings是非空中文义项的有序投影；schema拒绝二者不一致的数据。旧partOfSpeech/meanings仍可读，不对旧CaptureEvent自动补字段或改正文。旧词条继续显示旧编辑器；新词条使用义项编辑器。CSV仅为平面词库视图，不能完整往返义项；CSV补空保留结构化义项，完整JSON保留全部结构。

SQLite物理表、user_version=1、事件ID、设备ID、去重、批次路径、200KB预算、精确ACK与CaptureEvent外层schemaVersion=1保持。旧冻结批次不重写。没有新云端存储。词条首次派生仍使用原namespace 97bf633d-3fd0-5afd-9a4b-3f0fe7e44537 和 entry:<event.id> / initial-revision:<event.id>。

旧校验器严格拒绝未知字段，无法假装新增结构仍完全兼容旧客户端。因此**含lexicon的批次和主快照使用protocolVersion=2**，无扩展旧数据仍用1；新端接受1/2、拒绝未来版本和将扩展伪装为1的envelope。旧端会安全拒绝2。需要先更新全部Web同步端和Service Worker，再启用0.5.0结构化上传；不能把本机代码测试通过描述成公开网站已经兼容。

三方合并将lexicon作为原子字段，独立标签等仍可合并，并发义项编辑产生人工冲突，不按时间覆盖。决议后重建meanings。FSRS调度组及历史事件仍用原规则，测试核对采集/编辑未创建或删除评分、卡片。

## 4. 实际测试结果

环境：Windows 11 build26200、Node24.13.0、Electron44.9.0；复用既有React19.3.0、TypeScript6.0.3、Zod4.6.7、Dexie4.4.6、ts-fsrs5.4.2及锁文件。新桌面版本0.5.0。没有新依赖。

| 实际命令/范围 | 结果 |
| --- | --- |
| npm run check | 通过；含Web/Desktop TypeScript、ESLint、241项Web单元测试、Pages子路径构建、manifest/SW/资源校验、公开树秘密扫描 |
| npm run test:desktop | 33项通过，含真实SQLite、查询适配模拟、失败/超时/取消、稳定ID、人工修改、旧队列与上传故障 |
| npm run desktop:build | 通过，编译现有SelectionHelper及两种窗口资源；第三方署名加入词典来源说明 |
| npm run test:desktop:e2e -- --reporter list --output reports/test-results/phase-4.1/desktop-final | 4项通过、2项外部服务开关跳过；含实际Electron窗口/IPC、超时保留编辑、旧快捷键回归、义项新增删除/单项翻译/重复查询收藏 |
| PHASE41_LIVE_DICTIONARY=1；桌面E2E --grep 'LIVE public' | 独立真实服务专项1项通过，四个实际单词，见下表；不是mock |
| PLAYWRIGHT_CHANNEL=msedge；Web完整E2E | 35项通过、3项移动项目不适用的进程重开用例跳过；本地生产构建，包含旧/新批次、导航、离线、备份、同步和FSRS回归 |
| 最后补充模型一致性后，Web --grep 'desktop batch preview' | 桌面/移动共4项通过；v1/v2预览、接收、编辑及主快照传送 |
| electron-builder离线缓存打包，--publish never、独立输出目录 | 通过，Windows x64便携版；没有创建Release或发布 |
| 最终便携exe实际启动/离线收藏/退出/SQLite重开 | 通过；新临时目录、1个人工事件/2义项、原ID保留、pending、未绑定目标且未上传；测试进程已退出 |
| app.asar扫描 | 16个文件/目录项；版本0.5.0、词典署名存在、无识别Token/私库目录/SQLite/CSV文件。扫描工具最初两次路径分隔符错误，修正后才完成；不把失败尝试算通过 |
| 历史文件SHA256核对 | 115项无变化，包括既有SQLite、0.4.0/0.4.1产物和历史报告；正在供用户体验的0.4.1目录未关闭、清理或写入 |

真实Electron网络结果记录于2026-10-26 09:51:53 UTC。耗时包括词典和自动中文补充，**不是快捷键弹窗延迟或性能目标验收**，也不代表每次服务速度。

| 单词 | 实际义项/词性 | 实际中文数量 | 词形结果 | 该次完整耗时 |
| --- | --- | --- | --- | --- |
| perseverance | 1项，noun | 1 | IPA、词典明确词形；没有合规使用例句，因此留空 | 3047ms |
| run | 载入64项，adj/noun/verb；超过上限已提示 | 4 | 12词形、使用例句 | 2688ms |
| Haus | 4项，name/noun | 4 | das、Häuser、31词形 | 2305ms |
| gehen | 12项，verb | 4 | gehen / ging / gegangen、6项Präsens、sein、102词形 | 2885ms |

模拟测试覆盖EN多词性、多义项，DE明确冠词/复数/动词形，缺失字段、Provider失败/限流/超时、翻译失败、人工编辑/新增/删除、重复查询、稳定身份、SQLite重开、旧事件、新批次经HTTP适配及Web导入、冲突和投影。GitHub接口为人工模拟服务，不是真实私库写入。

测试证据分开保留：reports/test-results/phase-4.1/ 下有 web-e2e、web-capture-final、desktop-final、live-provider-electron；忽略的 .cache/phase4.1-dictionary/ 保存公开人工查询响应、实时结果摘要、便携验证和保护清单。它们不属于公开源码提交。未删除旧输出目录。

## 5. 本地交付与最简单体验步骤

目录：artifacts/desktop/dictionary-0.5.0/。

- 推荐入口：隔离测试启动-0.5.0.exe。启动器已编译并审阅固定目录、目标SHA及子进程环境变量；便携本体已用独立目录实际运行。启动器本身的正常双击交互尚未另行人工验收。
- 本体：Polar-Vocab-Capture-0.5.0-win-x64.exe，100,586,705字节；SHA256：619fd91f473d15239d3811797d4ba0de9b7053fbd8a3fd690e7d3f5f9b7400bb。
- 独立测试目录：同目录test-data-0.5.0；初始只含设置，没有目标仓库或凭证，autoSync=false。正常启动器不开放调试端口，不修改全局环境变量。不要直接双击本体使用默认AppData旧目录。
- 0.4.0原exe和hotkey-fix-0.4.1全部保留，SQLite旧队列不迁移。新版结构写入过的目录不可用0.4.x打开。

体验：如果旧版还运行，先从旧版托盘“退出并释放快捷键”（不要删数据）；双击新版隔离启动器；确认设置中快捷键注册成功，再在普通文本中选词按Ctrl+Alt+S，或直接输入perseverance并点“查询词典”。看到词性/原文后等待中文，核对后收藏。不填PAT，不连接GitHub即可体验。

## 6. 尚未验证、限制与停止范围

- **尚未部署**0.5.0 Web；真实私库端到端采集/同步、不同版本端混用和正式PWA跨版本升级未验证。旧公开Web不支持结构化协议2。需要单独授权发布后再做人工数据验收。
- 未执行iOS验收。Edge移动布局测试不等于iPhone测试；此前暂缓项不升级为通过。
- 未重新执行记事本/浏览器物理按键的跨应用性能测量；保留0.4.1的真实验收边界，不宣称200–300ms已经达标。
- 词典是在线服务，不是完整离线词典；离线时仍能人工编辑和SQLite收藏。服务覆盖、例句、中文和词形不保证齐全；上游超时/限流时留空或明确失败。
- 单次64义项、160词形；自动中文4项，其余逐项人工触发以控制免费额度。义项不够时可查来源，不生成假释义。机器翻译需核对。
- exe未签名、Windows10未实测，系统提示和其他应用选区兼容性沿用原边界。
- 代码留在当前工作区，包含原先0.4.1未提交修改；没有擅自提交、推送、部署或改变真实测试仓库。没有新增桌面功能、云数据库或后续阶段开发。
