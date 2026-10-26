# 0.6.0 文本、句中选词与词形证据

本文对应现有增量实现：apps/desktop/src/text-analysis.ts、sentence.ts、dictionary.ts、morphology.ts，以及统一桌面窗口中的SentencePane。原事件身份、旧词条、SQLite队列与FSRS保持既有边界；这不是另建词库或第二套同步系统。

## 识别模式与原文保持

自动模式只提供界面建议，不决定词条身份或语法。用户可以选择单词词典、短语或整句模式。

- 单词规则支持Unicode字母、组合附加符、数字、词内直/弯撇号和常见连字符；末尾单个句点及连续字母缩写句点也会作为单词候选。这不能保证每个缩写都存在词典条目。
- 换行、问号、感叹号、中文句末标点，或多个词末尾的句号，会建议句子模式。至少三个词且包含常见英德代词开头或限定动词时也会建议句子模式。其余多词内容建议短语。
- 规则不做语言学句法分析，可能误分不完整句、专有名词或特殊缩写。手动模式是必要回退，不宣称自动分类全正确。
- 英德均使用Intl.Segmenter的word粒度分词。只有word-like且含字母的片段可点击，纯数字和标点保留为普通文本。每片段保留原字符串中的UTF-16 start/end偏移，连接所有片段应精确等于原文；空格、标点、顺序和德语变音字符不重排。
- 词内连字符在单词模式可作为整体查询；Intl.Segmenter在句中可能把连字符两侧分开。用户仍可编辑当前收藏目标或以短语方式查询，不把分词边界当词形还原证据。

手动输入原文不逐字自动发送外部请求。快捷键得到的明确选区和用户点击的词可按“自动查询/允许外部查询”设置处理；关闭外部查询后仍可输入、修改、选词和离线收藏。不会额外抓取未选中的窗口上下文。

## 整句翻译与失败处理

SentencePane并列显示可点击原文和可编辑中文，翻译状态独立于词典/收藏。词典和整句请求使用不同请求ID，取消、切换或人工编辑后旧结果不能当成新的输入。原文保持可用，用户可在翻译等待或失败时继续选词和手工填写。

SentenceTranslator仍使用独立MyMemory Provider，不用词典原文冒充机器翻译：

1. 接受非空、最多5,000字符的明确所选文本；不会把额外原句、标签、队列、GitHub凭证拼入请求。
2. 先按CR/LF划分段落，再以Intl.Segmenter的word片段组合成不超过500 UTF-8字节的请求。原始偏移保留；一次请求不横跨多个段落。连续单个片段本身超限时明确提示，不截断词或虚构译文。
3. 一轮最多40片段、同时最多2个翻译请求；总截止时间30秒，Provider单次仍受原有10秒和响应大小限制。
4. 每片段独立记录waiting/translated/failed及偏移。某片失败时保留其他译文，不让整个收词窗口退出或清空原文。
5. 拼接的中文是候选内容，不保证段落排版与原文完全对应；原文视图始终使用未改动的文本。部分结果明确标为不完整，用户补齐后再决定是否随收藏保留。

MyMemory匿名免费额度约5,000字符/日，不代表无限免费；重复长段落查询会更快消耗额度。界面说明文本可能被服务保留、用于翻译合作方处理。没有调用付费服务、上传语料接口或向API提交邮箱来扩大额度。用户可完全不请求网络，手动填写中文。

## 词形还原只使用明确关系

优先使用既有WiktApi的英语Wiktionary版，限定所选词语的en/de语言。没有引入大型模型、词尾截断器或收费形态分析服务。

真实响应中，definitions端点含POS和定义标签，但裁掉form_of/alt_of；完整word端点保留这些关系，却缺少顶层POS/语言。实现因此：

1. 按原有definitions/forms/pronunciations查询词条，核对返回原词和目标语言。
2. 仅当已确认语言的定义有form-of/alt-of标签时，再读取该原词的完整word响应。
3. 按**完整glosses和tags**与已确认语言的定义匹配，读取明确的form_of/alt_of.word；不按两端数组序号配对，不从英文释义里的“of”文字或原词后缀猜原型。
4. 返回lemmaCandidates，包含原型、可用POS、词形标签及Wiktionary来源。不同关系可指向同一原型，标签如nonstandard、archaic保留。原词有独立义项时也标记，供界面提示用户保留原词或选择候选。
5. 有歧义时不静默选择胜者；没有可验证的关系时保留原词形。用户选择原型后查询该原型的完整义项，原始遇到的词形另外保留。

候选最多20个，定义/词形和响应大小仍受原有预算约束。完整关系查询失败只增加提示，已获得的原词义项和人工编辑继续可用。字典义项ID沿用Phase4.1的稳定算法，人工改写/删除标记继续参与重复查询归并。

## 实际公开服务验证

2026-10-26使用最终WiktApiProvider进行了以下真实HTTPS查询。仅使用人工词，无MyMemory或GitHub调用；结果和原始响应保存于本轮忽略的.cache工作目录，不覆盖历史词典验收资料。

| 原词形 | 实际明确原型 | 词典标签/歧义摘要 | 该次Provider完整耗时 |
| --- | --- | --- | --- |
| persevered | persevere | past / participle；无独立词义标记 | 1702ms |
| difficulties | difficulty | plural；原词还存在独立colloquial义项，需要保留选择 | 1171ms |
| went | go、wend | go有标准past及nonstandard participle两个关系；wend为archaic；原词另有独立义项 | 1071ms |
| Häuser | Haus | nominative / accusative / genitive / plural | 1128ms |
| ging | gehen | first-person / third-person / singular / preterite | 1136ms |
| gegangen | gehen | past / participle | 1125ms |

六个指定目标原型均由真实form_of数据返回。以上只是这次词典和元数据网络查询耗时，**不是快捷键至窗口可见的时间，也不是200–300ms目标的证据**；不保证下次请求相同速度。模拟测试另外覆盖顺序改变、假后缀、缺失关系、语言/原词不匹配、候选歧义及失败不丢原义项；不能把这些模拟用例称为真实服务通过。

## 收藏、上下文与同步

VocabularyPayload保留lemma作为收藏目标；encounteredForm保存原词形；lemmaResolution保存用户所选明确候选的tags、POS和来源，且必须与当前lemma对应。用户手改原型后不能继续保留不匹配的词典证明。

每个CaptureEvent仍自足保存context.id/text及可选translation、translationLanguage='zh-CN'、translationSource。一个原句内多个单词可以复用同一context ID，但无需先下载另一份外部context记录才能导入，避免悬挂引用。大段重复会受到既有事件/批次字节预算限制，分批而不丢掉关联。

这些新字段即使没有lexicon也要求protocolVersion=2。新客户端可读旧v1，旧CaptureEvent不自动补字段或重写正文；不能把新字段伪装成v1。Web编辑器保留原词形和证明，允许编辑句译并记录修改来源；三方合并把原型、原词形、证明绑定处理，含译文的context作为原子字段保留，冲突由人工决定，不能丢来源或按更新时间覆盖。

公开Web部署、真实私库端到端、统一目录迁移与Windows响应性能的最终状态以INTEGRATED_RELEASE_REPORT为准，本文不替代相应验收，也不声称完成iOS真机测试。

## 数据来源与许可

- [WiktApi端点与语言](https://wiktapi.dev/quickstart)、[数据管线](https://wiktapi.dev/concepts/data-pipeline)：公开免Key接口；没有承诺SLA或不限流。
- [Wiktextract的form_of/alt_of定义](https://github.com/tatuylonen/wiktextract#word-senses)：从明确结构读取词形关系。
- [Kaikki数据来源](https://kaikki.org/dictionary/)、[Wiktionary版权](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)、[CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)：词典原文/关系保留来源、许可及修改标记，不把软件自身许可当词典内容许可。
- [MyMemory接口](https://mymemory.translated.net/doc/spec.php)、[免费用量](https://mymemory.translated.net/doc/usagelimits.php)、[服务条款](https://mymemory.translated.net/terms-and-conditions)：机器翻译/翻译记忆候选与词典数据分开；不是统一开放许可的可任意再分发语料库。

未自动复制文献quotation或打包音频。更多既有Provider取舍见[DICTIONARY_PROVIDERS](DICTIONARY_PROVIDERS.md)。
