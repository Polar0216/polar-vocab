# 英德词典数据来源（0.5.0）

核查日期：2026-10-26。只采用免费公开查询，不创建账号、购买额度、接入收费服务或下载整个词典。服务条款和可用性可能变化；下列结论不代表不限流或永久可用。

## 选择与对照

| 方案 | 英德与字段 | 中文 | Key / 费用 / 限制 | 数据许可与本项目决策 |
| --- | --- | --- | --- | --- |
| WiktApi → Kaikki / Wiktionary | `edition=en`、`lang=en/de`；按义项词性、英文定义、使用例句、IPA、带标签词形。覆盖取决于词条 | 中文翻译表不保证与义项精确对应，本项目不自动配对 | 免 Key、公开免费；未找到保证额度、正式 SLA 或固定速率承诺；429/错误停止，用户可重试 | 采用。原文 CC-BY-SA-4.0，附词条链接和修改标记；Kaikki 同时说明 Wiktionary 的 CC-BY-SA / GFDL 来源 |
| MyMemory / Translated | EN/DE → 中文翻译记忆及机器翻译；不提供可靠词性或德语词形 | 有，按每条原文定义独立翻译；词典无结果时可提供短语候选 | 匿名5,000字符/日，单次500 UTF-8字节；不提交 email、不用 Key、不使用 set/import 或付费 API | 延用并修正候选识别。按官方 API 个人查询；不是开放词典数据包，不声称所有返回内容可任意再分发 |
| Free Dictionary API | 官方首页展示英语多词性、定义、例句、发音；未核实可满足德语词形的支持 | 未确认提供中译 | 公开免费，无 Key 的英语示例；不当作德语保证 | 未接入。无需为英语另引一套来源，也不把代码许可当成全部词典内容许可 |
| Kaikki 原始开放数据 | 英德及其他语言结构化 JSONL，词性、义项、词形、例句 | 随 Wiktionary 版本与词条而异 | 可下载；整库规模较大，需要本地索引和更新 | 本期通过 WiktApi 使用其提取结果，不新增大型离线词典下载或自己的服务 |
| PONS API | 官方文档有词性、义项、方向和参考条目；提供多种词典（具体英德中授权组合须确认） | 依实际授权词典 | `X-Secret` 凭证；额度与商业条件需另行申请确认，未承诺免费 | 未接入、未开通费用。不是无条件开放数据再分发来源 |

## 采用方式与边界

- `WiktApiProvider` 请求 `/definitions`、`/forms`、`/pronunciations`，限定语言、核对返回原词。不做本地词尾猜测或自动改大写。真实 `/word` 完整端点在本次测试中缺少顶层 POS，因此不能按文档示例直接用它。
- 原文定义来自英语版 Wiktionary，包括德语单词的英文释义。界面显示原文语言。德语例句自带的译文是英语，不冒充中文。
- 词典先显示，翻译随后独立补充。自动最多4项、并行最多2项；其他项可点「翻译义项」，单个超过500字节则保持原文供人工填写。每次查询最多64义项，各词性交替取用，超限有提示；词形最多160项。
- 8秒词典超时、2MB响应上限；翻译沿用10秒、500KB上限。没有自动重试风暴；单独翻译与整次查询均可取消，保存时停止未完成查询。进程内最多缓存100条定义译文，不承诺跨进程缓存或离线词典查询。
- MyMemory 仅接受完整原文和语言对应的高匹配候选，或明确 `created-by=MT!` 的**相同原文**机器翻译；不把相近句子的中文贴到当前义项。机器翻译仍须人工核对，不作为词典原生中文释义。
- 查询仅发送原词、义项定义；不发送另填的原句、标签、队列、Token。供应商可能长期保存查询并使用翻译合作方；不要查询敏感内容。

## 署名、许可与再分发

每项词性、原文、例句、词形保留 Wiktionary 页面链接和 `CC-BY-SA-4.0`；用户改写保留来源并标 `modified=true`。WiktApi 和 Kaikki 为处理链，Wiktionary 贡献者为内容来源，链接页面历史可追溯作者。软件本身的 `UNLICENSED` 不覆盖这些开放词典内容。

仅复制无文献引用、`type=example` 的使用例句；引用书籍的 quotation 不自动收藏。音频未下载或打包，因为媒体可能有独立许可；只使用 IPA。没有把整份第三方词典编进 exe。公开分享来源内容及其改编时须保留署名、链接和相同/兼容许可，中文翻译不自动获得与词典完全相同的许可；学习记录和私人备份无需因本功能公开发布。

MyMemory 条款允许符合限制的自动 API 访问，禁止爬库、异常流量等；返回候选不是许可统一的开放数据集。本功能面向个人逐词学习，不提供公共词典镜像或批量再分发能力。条款已通过本机公开 HTTPS GET 核对；浏览工具访问该条款曾超时，二者如实区分。

## 官方依据

- [WiktApi Quickstart（免 Key、端点、edition/lang）](https://wiktapi.dev/quickstart)
- [WiktApi 数据管线与缓存](https://wiktapi.dev/concepts/data-pipeline) · [维护者及免费开源说明](https://wiktapi.dev/about)
- [Kaikki 数据许可](https://kaikki.org/dictionary/)
- [Wiktionary 内容版权与外部引文例外](https://en.wiktionary.org/wiki/Wiktionary:Copyrights) · [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- [MyMemory API](https://mymemory.translated.net/doc/spec.php) · [免费用量](https://mymemory.translated.net/doc/usagelimits.php) · [条款](https://mymemory.translated.net/terms-and-conditions)
- [Free Dictionary API 官方说明](https://dictionaryapi.dev/)
- [PONS 官方接口文档](https://en.pons.com/assets/docs/api_dict.pdf)
