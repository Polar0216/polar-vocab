# 文件夹与日常入口

背词、整理和复习使用[完整网站](https://polar0216.github.io/polar-vocab/)。按用户最新要求，本机整个Git工程收进 `project/`，最外层只保留以下4项；工程内部相对路径、Git历史、依赖和Actions不变：

```text
polar-vocab/
├─ 使用说明.md                 日常操作与全部文件夹说明
├─ 启动Capture收词.lnk        指向project内当前0.6.1便携版
├─ 打开背词软件.url            打开正式背词、词库和复习网站
└─ project/                   完整工程、报告、程序及历史资料
```

桌面原入口已移到 `project/artifacts/desktop/history/shortcuts/`，没有删除程序。Capture关闭窗口是隐藏到托盘，切换版本前从托盘正常退出。以下为 `project/` **内部**结构，也仍是公开仓库的根结构；远端没有额外套project层：

```text
project/
├─ src/                         Web应用源码
├─ apps/desktop/                Windows收词器源码与原生helper
├─ packages/shared/             两端共用的模型、协议和义项编辑组件
├─ tests/                       Web单元及集成测试
├─ scripts/                     开发、构建和安全检查脚本
├─ docs/                        需求与技术说明
├─ reports/                     阶段报告及验收记录
│  └─ test-results/             本机自动化执行输出（不提交）
├─ artifacts/desktop/           本机可执行程序（不提交）
│  ├─ current/                  当前日常便携版0.6.1
│  ├─ history/                  0.4.0/0.4.1/0.5.0/0.6.0及原测试目录
│  │  └─ cleanup-20261027-recoverable.zip
│  └─ build-output/             下次打包才生成的中间产物
├─ .cache/                      本机备份、验收profile、原始证据（不提交）
├─ public/                      Web静态图标
└─ .github/workflows/           公开站构建和部署
```

工程配置、依赖锁文件和README都在project内部的工程根目录，开发时先进入project再运行npm命令。没有逐个搬动源码或修改导入路径。`node_modules/`、`dist/`、桌面`build/`是可重建开发输出；它们不作为日常程序入口。历史证据中的旧工程绝对路径统一增加project层查找，原始证据不改写。外层Capture快捷方式目前使用固定目标；再次移动整个外层目录时需更新目标。

正式数据在工程以外：`%APPDATA%/Polar Vocab/Capture/captures.sqlite`，配置及连接目标保存在同一SQLite的metadata，迁移备份与日志也在此数据目录。浏览器运行缓存位于同级 `Capture.runtime/`；记住的凭证在Windows凭证管理器。移动exe不会移动或清空词库。Web的IndexedDB由浏览器profile管理，和桌面SQLite独立。

本次只删除已完整归档并校验SHA256的重复构建副本，历史程序、SQLite/备份、测试profile和阶段报告保留。可恢复zip包含原相对路径；需要恢复某项时解压到新的空目录，核对后单独取回，不要覆盖活跃数据。验收profile及`.cache/`可能包含私人备份，不能上传公开仓库，也不要一键清空。详情见[整理与验收报告](../reports/integrated/CLEANUP_AND_LIVE_ACCEPTANCE_20261027.md)。
