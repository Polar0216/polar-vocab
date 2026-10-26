# GitHub 私有词库设置

## 0.6.0 Windows 采集连接

先阅读 [Windows 使用说明](WINDOWS_CAPTURE.md)、[安全授权](INTEGRATED_AUTH.md) 与 [采集协议](CAPTURE_PROTOCOL.md)。本轮只用 `Polar0216/polar-vocab-data-test / main` 人工数据，不初始化或清空已有主快照，不删除旧词条、卡片、评分、冲突、决议及批次。

使用仍有效、权限符合要求的有限期 Fine-grained PAT；已有凭证符合时无需新建：Resource owner=Polar0216，Only select repositories仅选该私库，Contents=Read and write，Metadata默认只读，不加其他权限。不得发送到聊天、项目、截图或日志，不复用以前贴到聊天中的凭证。

桌面设置填写owner/repo/branch，点击「输入凭证并测试（系统窗口）」，在出现的本应用原生密码框本人输入PAT。只读预检后核对目标，再明确确认；可勾选「记住此设备（Windows凭证管理器）」，下次启动异步复验并恢复。未勾选只在本次主进程内存使用。网络暂不可用不会删除已保存凭证，已保存授权401才失效；断开并忘记后不再恢复，队列保留。Web下方的首次连接流程仍是浏览器内存授权，两者不同。

桌面上传前还会在线核对正式站release.json支持协议1/2和当前上下文字段。未确认则暂停上传，不影响离线收藏；先完成兼容Web部署和行为验证，不能用旧接收器接收新扩展。桌面只创建 `captures/{deviceId}/{YYYY-MM}/{batchId}.json`，不写 `data/state.json`。Web生词箱检查、预览并确认接收后，仍由原同步引擎写正式词库。

0.5.0阶段曾禁止向当时旧Web上传；那是旧版本边界。本轮0.6.0已授权普通代码推送及Pages部署，实际发布和真实私库链路结果见[整合报告](../reports/integrated/INTEGRATED_RELEASE_REPORT.md)。授权、安全存储、模拟GitHub、真实私库分别验收，不能从连接成功推定上传、去重或重启恢复全部通过。未创建Release或自动上传exe。

下文保留Phase3/3.5主同步操作与历史状态，未测iPhone/401/SW项目不自动升级为通过。

适用于Phase3/3.5，公开代码仅 `Polar0216/polar-vocab`，唯一人工私库 `Polar0216/polar-vocab-data-test`。首次及修复982b023普通push成功，[Actions](https://github.com/Polar0216/polar-vocab/actions/runs/38702050828)成功由API独立确认，正式站A–G通过。H的幂等、进程恢复、收词/评分精确ACK、同profile标签锁、离线刷新及替代凭证重授权/最终收敛均通过；真实401按用户选择保留未验证，H仍记部分通过。iPhone1–3、6、8–10用户反馈通过，第4部分，11–13由用户暂缓，其余未测不扩展。本轮可执行部分结案，整体尚未完整验收，该轮未授权Phase4；现有另行授权允许Phase4，未测项仍保留。**不要把Token发到聊天、文件或截图**。

## 1. 核对已创建的仓库

本次两个仓库已由用户创建，不要重复创建、改名或互换用途。公开网站源码只推送到 `https://github.com/Polar0216/polar-vocab.git`，测试数据只允许写入 `Polar0216/polar-vocab-data-test`。

1. 打开测试仓库的 GitHub 页面，确认名称和 **Private** 标记，不能仅凭未登录访问404推断私有状态或空数据。
2. 确认已有 README 提交和有效分支；如果完全空仓库，由用户确认后在网页初始化 README，保留已有内容，不覆盖已有文件。
3. 记下实际默认分支。网站不会创建仓库或分支；分支保护/组织策略可能阻止写入。
4. 公开仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。推送前先批准待公开提交；工作流通过并产生部署 URL 后，再检查正式站点 `https://polar0216.github.io/polar-vocab/`。

首次运行 [38687892583](https://github.com/Polar0216/polar-vocab/actions/runs/38687892583) 在 Configure Pages 返回404。设置 Source 后，在运行页面右上 Re-run jobs → Re-run failed jobs；没有按钮时确认已用仓库所有者账号登录。不要为绕过配置问题改用私人 PAT、扩大 Actions 权限或关闭安全规则。

不在代码仓库保存私人 JSON、备份、PAT；不要用未来正式数据仓库进行本次故障测试。

## 2. 创建最小权限凭证

1. GitHub 头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. 名称可注明设备，例如「Polar Vocab 手机」；设一个有限有效期，使用不同设备的独立凭证，便于分别撤销。
3. Resource owner 选数据仓库的所有者。
4. Repository access 选 **Only select repositories**，仅选择刚才的数据仓库。
5. Repository permissions 中 **Contents → Read and write**。GitHub 自动要求的 Metadata 只读保留，不额外授予 Workflows、Actions、Administration 或账户权限。
6. Generate token，立即在可信设备的网站设置中输入。组织可能要求审批，未审批的凭证不能访问私有内容。离开生成页面后通常无法再次查看完整值，丢失时重新生成，不在聊天中索取。桌面请在原生授权窗口输入，Web请在可信正式网站输入。

参考：[GitHub 官方 PAT 操作说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。只读测试不能证明写入权限，实际首次确认提交才会验证 Contents 写权限及分支规则。

## 3. Web 首次连接

1. 打开可信 Polar Vocab 站点，先在设置导出完整 JSON，确认备份已保存到自己的私人位置。
2. 「GitHub 私有同步」输入所有者 `Polar0216`、仓库 `polar-vocab-data-test`、PAT；分支可留空使用默认分支，或填写已有分支名称。
3. 点击「测试连接（只读）」。此时只检查仓库私有、名称、分支、Contents 读取，以及云端快照结构和算法；不会写远端或替换本机词库。
4. 查看弹窗本机/云端词条与评分数量、文件大小、预检冲突和共享学习设置。云端已有设置时，明确选择采用云端还是保留本机后生成新的共同修订。
5. 下载连接前完整备份，确认文件已落盘后勾选确认，点击「确认连接并同步」。确认后仍会重新读 SHA，不能把预览当作强制覆盖许可。
6. 显示已同步且 pending 为 0，才表示这次本机修改已经确认。存在冲突时请检查下方冲突区，云端未被强制覆盖。本机与云端都存在独立记录时并集合并；缺少某记录不代表删除。

初始 A/B：云端没有 state.json，仓库/分支/读取权限已确认，再初始化。C：本机空、云端有数据，验证后导入。D：两边都有数据，公共基线或保守新增合并，不能证明安全时进入冲突。E：协议不兼容，不覆盖、不清空。

## 4. Web 第二台设备与日常使用

第二台设备打开同一版本网站，用自己的 PAT 连接同一个 owner/repo/branch。检查预览并确认后会下载完整词条和历史，本机设备身份及默认录入语言不被其他设备替换。

默认手动同步。可打开自动同步：本机操作先成批等待，至少一分钟间隔，前台/联网/结束学习触发，失败有限退避；每次评分不会单独产生一次 commit。关闭网页不保证最终上传，请离开设备前手动同步并核对状态。

Web PAT只在当前页面运行内存中。刷新、关闭页面或重启浏览器后重新输入；连接目标可以保留，但「需要重新授权」不等于数据丢失。断开连接会清理内存授权及连接，保留词库与 pending；若不再使用凭证，也在 GitHub Token 页面撤销。

本次用户曾在聊天主动提供两枚测试凭证，并随后明确授权临时测试使用；凭证未写入项目、备份或公开产物，验收结束后需由用户撤销。日常仍只在正式网页输入，不在聊天发送。这次授权恢复连接不等于真实401测试通过；真实401已按用户选择保留未验证。

单文件 720,000 字节起预警，900,000 字节上限。超限时保留本机所有数据，可导出 JSON，不能通过删除审计或截断文件绕过。当前没有自动分片或历史压缩。

## 5. 真实私有测试仓库验收清单（A–G通过，H部分完成）

仅对指定人工私库执行，不用既有个人词库或重复初始化。A–E双向新增、真实FSRS、离线/字段合并及同字段决议通过；F旧版整库失败修复后已用原墓碑/审计复验收敛。每轮独立浏览器与真实私库核对，不输出或持久化Token。ETag、限流、实际撤销凭证等仍逐项记录，不能从一般同步推定通过。

G原分叉/决议及实际到期后父引用、整库收敛和重复SHA稳定均通过。旧profile存储失败后保留目录，新profile正常UI恢复原记录，用户自行重新预检/备份/确认同一已初始化私库续测；没有重建词/远端或当成正常SW升级通过。H控制工具中断后原冻结批次和后写pending保留，重新授权恢复同步通过；修正门闩工具后，新收词F1/L1与评分F1/L2精确ACK分别通过，同profile的A2标签被同步租约阻止且无多余PUT。后续离线新增/刷新保留全部存储记录和原pending ID；用户明确授权临时测试凭证，经一次性内存通道交给原A/B网页，只读预检、备份确认、原pending同步和最终收敛均真实通过。12:09:43UTC两端各14词/3卡/5评分，全部共享集合/SHA一致、pending/冲突/活动任务均0。GET200/304和PUT200实际观察，初次创建201未捕获。真实401未观测到，用户选择保留未验证，H因此仍部分通过；不把普通重授权记作401处理通过。旧临时JSONL/脚本不完整，备份在忽略的 `.cache/phase3.5-real-sync/`。

真实iPhone单独验收。用户反馈iOS26.6第1–3、6、8项通过，并对离线Good评分与关闭重开明确反馈通过（第9、10项）；剪贴板导入正常但第4项单次计数未知。第5项拒绝回退、第7项德语结构字段和第14项跨版本更新仍未验证；用户明确暂缓11–13真机同步，本轮不再催促。Chromium或桌面恢复不能替代真机/正常更新；边界见[DEVELOPMENT](DEVELOPMENT.md)。

公开 Pages 资源仍公开。浏览器扩展、XSS 和恶意系统软件可以读取运行内存；最小权限、有效期、可信站点和定期撤销是必要边界。GitHub 私有仓库及 IndexedDB 都不是端到端加密保险箱。

Phase 3.5 每项真实验收及 iPhone 操作见 [REAL_DEVICE_CHECKLIST](REAL_DEVICE_CHECKLIST.md)。只有凭证在可信网页用于已授权测试、并取得对应实际结果，才能把该项目从未验证改为真实远端通过。
