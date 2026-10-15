# GitHub 私有词库设置

适用于 Phase 3/3.5。网站代码可以公开；词库必须使用独立私有仓库。当前任务的公开目标为 `Polar0216/polar-vocab`，唯一私有测试目标为 `Polar0216/polar-vocab-data-test`。首次 push 和上线仍待用户批准及实际执行。请在浏览器自行完成下面操作，**不要把 Token 发给聊天、写进项目文件或截图**。

## 1. 核对已创建的仓库

本次两个仓库已由用户创建，不要重复创建、改名或互换用途。公开网站源码只推送到 `https://github.com/Polar0216/polar-vocab.git`，测试数据只允许写入 `Polar0216/polar-vocab-data-test`。

1. 打开测试仓库的 GitHub 页面，确认名称和 **Private** 标记，不能仅凭未登录访问404推断私有状态或空数据。
2. 确认已有 README 提交和有效分支；如果完全空仓库，由用户确认后在网页初始化 README，保留已有内容，不覆盖已有文件。
3. 记下实际默认分支。网站不会创建仓库或分支；分支保护/组织策略可能阻止写入。
4. 公开仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。推送前先批准待公开提交；工作流通过并产生部署 URL 后，再检查正式站点 `https://polar0216.github.io/polar-vocab/`。

不在代码仓库保存私人 JSON、备份、PAT；不要用未来正式数据仓库进行本次故障测试。

## 2. 创建最小权限凭证

1. GitHub 头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. 名称可注明设备，例如「Polar Vocab 手机」；设一个有限有效期，使用不同设备的独立凭证，便于分别撤销。
3. Resource owner 选数据仓库的所有者。
4. Repository access 选 **Only select repositories**，仅选择刚才的数据仓库。
5. Repository permissions 中 **Contents → Read and write**。GitHub 自动要求的 Metadata 只读保留，不额外授予 Workflows、Actions、Administration 或账户权限。
6. Generate token，立即在可信设备的网站设置中输入。组织可能要求审批，未审批的凭证不能访问私有内容。离开生成页面后通常无法再次查看完整值，丢失时重新生成，不在聊天中索取。

参考：[GitHub 官方 PAT 操作说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。只读测试不能证明写入权限，实际首次确认提交才会验证 Contents 写权限及分支规则。

## 3. 首次连接

1. 打开可信 Polar Vocab 站点，先在设置导出完整 JSON，确认备份已保存到自己的私人位置。
2. 「GitHub 私有同步」输入所有者 `Polar0216`、仓库 `polar-vocab-data-test`、PAT；分支可留空使用默认分支，或填写已有分支名称。
3. 点击「测试连接（只读）」。此时只检查仓库私有、名称、分支、Contents 读取，以及云端快照结构和算法；不会写远端或替换本机词库。
4. 查看弹窗本机/云端词条与评分数量、文件大小、预检冲突和共享学习设置。云端已有设置时，明确选择采用云端还是保留本机后生成新的共同修订。
5. 下载连接前完整备份，确认文件已落盘后勾选确认，点击「确认连接并同步」。确认后仍会重新读 SHA，不能把预览当作强制覆盖许可。
6. 显示已同步且 pending 为 0，才表示这次本机修改已经确认。存在冲突时请检查下方冲突区，云端未被强制覆盖。本机与云端都存在独立记录时并集合并；缺少某记录不代表删除。

初始 A/B：云端没有 state.json，仓库/分支/读取权限已确认，再初始化。C：本机空、云端有数据，验证后导入。D：两边都有数据，公共基线或保守新增合并，不能证明安全时进入冲突。E：协议不兼容，不覆盖、不清空。

## 4. 第二台设备与日常使用

第二台设备打开同一版本网站，用自己的 PAT 连接同一个 owner/repo/branch。检查预览并确认后会下载完整词条和历史，本机设备身份及默认录入语言不被其他设备替换。

默认手动同步。可打开自动同步：本机操作先成批等待，至少一分钟间隔，前台/联网/结束学习触发，失败有限退避；每次评分不会单独产生一次 commit。关闭网页不保证最终上传，请离开设备前手动同步并核对状态。

PAT 只在当前页面运行内存中。刷新、关闭页面或重启浏览器后重新输入；连接目标可以保留，但「需要重新授权」不等于数据丢失。断开连接会清理内存授权及连接，保留词库与 pending；若不再使用凭证，也在 GitHub Token 页面撤销。

单文件 720,000 字节起预警，900,000 字节上限。超限时保留本机所有数据，可导出 JSON，不能通过删除审计或截断文件绕过。当前没有自动分片或历史压缩。

## 5. 真实私有测试仓库验收清单（尚未执行）

仅对你明确指定的专用测试仓库执行，先用人工词条和独立浏览器配置，避免真实词库。核对 Private，初始化 README 和分支，按最小权限生成两独立 PAT。检查真实浏览器 CORS、API 版本、ETag/限流头可读性、GET/Create/Update SHA 和分支规则；验证刷新后重新授权。

设备 A 收词后同步，B 下载；两端离线新增不同词后同步。再验证独立字段合并、同字段冲突、删除/编辑、同模板卡片及离线 Good/Again 分叉、人工决议与下一次评分。断网、撤销 Token、上传响应丢失、备份恢复后重新连接都要保留本机历史。测试时只在可信 UI 输入凭证，不将请求头或私人响应复制到报告。

真实 iPhone Safari 和主屏幕 PWA 单独执行：授权、剪贴板、离线复习、刷新、文件备份、双设备冲突、重新授权。Chromium 手机模拟不能替代。远程 Pages/Actions 与真实发布后的 SW 更新另按 [DEVELOPMENT](DEVELOPMENT.md) 验收。

公开 Pages 资源仍公开。浏览器扩展、XSS 和恶意系统软件可以读取运行内存；最小权限、有效期、可信站点和定期撤销是必要边界。GitHub 私有仓库及 IndexedDB 都不是端到端加密保险箱。

Phase 3.5 每项真实验收及 iPhone 操作见 [REAL_DEVICE_CHECKLIST](REAL_DEVICE_CHECKLIST.md)。只有用户在可信网页输入凭证并实际完成测试，才能把对应项目从未验证改为真实远端通过。
