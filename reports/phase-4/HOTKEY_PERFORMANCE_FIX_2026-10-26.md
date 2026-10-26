# 快捷键响应修复：实现与阶段验收

日期：2026-10-26。版本：0.4.1 候选版。范围仅为全局快捷键、取词等待、弹窗可靠性和性能日志。

**代码修复和自动回归已完成；新版的记事本、Edge/Chrome 跨应用实测尚未完成，不能宣称200–300ms反馈或1秒内取词已达标。** Windows自动化先被物理Esc中止，用户回复继续后恢复；随后因工具无法可靠确认当前浏览器URL而再次停止。本轮没有改用其他接口绕过该限制。下面分别列明实际数据、模拟检查与未验证项。

## 1. 原因与修改

旧版 `captureSelection()` 在原生进程完成后才显示主窗口，外层等待上限7000ms。UIA、松键及复制等待串行叠加；`if (!reading)` 使读取期间的后续快捷键直接丢失。旧版按固定次数执行 `Thread.Sleep(20)`，在本机两次复制失败路径中实际等待约1.24秒，不能把40次循环当作精确800ms。

现在快捷键同步显示已经加载好的小型反馈窗，原生读取异步进行；完成后才打开完整收词窗。反馈窗 `focusable:false`、`showInactive()`、置顶、跳过任务栏并穿透鼠标，不调用 `focus()`。它与主窗口分别使用受限preload，仍只加载本机协议、sandbox及contextIsolation，不开放Node或网络。

`CaptureFlow` 为每次触发生成临时请求UUID，立即反馈，取消旧请求；只接受最新结果。关闭窗口或Esc会取消当前意图，迟到结果不能重新打开窗口。旧编辑保留，读取期间及新结果完成渲染确认前，前后端均阻止收藏旧内容；请求UUID不是CaptureEvent ID，不改变原事件身份规则。

## 2. 原生读取与安全边界

`SelectionReader` 预热一个隐藏的原生broker，通过stdin/stdout交换受约束的具名JSON消息，不把选词作为进程参数。broker收到请求即记录前台HWND和PID，保留一个执行请求及一个最新等待请求；剪贴板操作始终串行。每次读取前后检查原窗口、PID和前台身份，仍逐级检查UIA密码标志及窗口归属。

UIA读取预算600ms；UIA线程超时后返回手动输入并结束该broker，后续请求可重新启动，避免失控UIA线程持续积累。取词最多读取501个UTF-16代码单元以判断是否超过500上限，超长拒绝而不静默截断。

松键、复制轮询及剪贴板占用重试改用Stopwatch真实截止时间：松键220ms、复制轮询250ms、每次OpenClipboard重试80ms。松键检查包含当前配置的字母/数字键；仍保留密码区域、前台检查、仅纯文本备份、序列号、复制所有者、部分SendInput释放按键及恢复前二次序列检查。不新增远程内存读取、任意窗口消息取词或剪贴板监听。

父进程1800ms软超时会显示手动输入结果并发送取消；不会为了早点返回而强杀可能正在恢复剪贴板的broker。未完成清理时后续请求走手动输入，收到终态或进程退出后恢复。源窗口已切换时主窗口使用非激活显示和任务栏提示，避免强行抢回新窗口焦点。系统权限、应用不响应及剪贴板管理器仍可能导致安全回退，不能承诺所有格式与异常进程均能无损恢复。

## 3. 弹窗与翻译

反馈窗只显示读取状态；主表单先更新原词，再由原有异步翻译接口请求候选。新取词会取消旧翻译；翻译失败/超时保留窗口和人工编辑。没有改变MyMemory供应商、额度、GitHub同步、FSRS、CaptureEvent及SQLite队列格式。

新增真实Electron运行测试用人工IPC结果验证状态机与编辑保留，并让人工网络适配器等待原有10秒超时：窗口仍可见、释义保留，队列没有自动增加。**这是实际Electron运行中的模拟选区/网络故障，不是Notepad/Edge真实取词性能或真实供应商耗时。**

## 4. 性能日志

实际目录为设置页显示的数据目录，新增 `logs/performance.jsonl`，保留原 `events.log`。每条记录只包含schemaVersion、时间、临时requestId、固定阶段/结果/失败代码、应用类别和耗时。

- 主阶段：feedback-show、feedback-paint、selection-ready、selection-paint、discarded。
- 原生阶段：queueMs、uiaMs、keyReleaseMs、clipboardBackupMs、copyWaitMs、readRestoreMs、totalMs。
- 类别限定notepad/edge/chrome/other/unknown，不记录原始程序名、路径、PID或窗口标题。
- 严格schema拒绝选词、释义、剪贴板、Token、原始异常及额外字段；同一请求的相同阶段去重，日志上下文只保留最近64个请求。

起点是实际 `globalShortcut` 回调内的单调时钟。show记录表示窗口显示调用已返回；paint记录为双requestAnimationFrame回执，**不是摄像机或屏幕像素级出现时间，也不包含按键进入系统到回调之间的延迟**。实测时还必须核对真实前台与可见窗口；单元测试中的虚拟时钟不计作性能数据。

## 5. 已取得的旧版实测数据

对原0.4.0构建建立独立副本，仅增加计时，不改等待逻辑；原便携exe保留。测试使用新建隔离队列和记事本人工文本，未连接私库或启用翻译。所有时间单位为毫秒。

| 样本 | 控制情况 | 结果 | 显示调用完成 | 双帧回执 | helper整体 | 原生总计 | UIA阶段 | 松键 | 剪贴板备份 | 复制等待 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Sky触发，人工词已选中 | manual，复制无新内容 | 1714 | 1723 | 1707 | 1453 | 136 | 0 | 0 | 1242 |
| 2 | Sky触发，重新核对编辑区选区 | manual，复制无新内容 | 1489 | 1491 | 1485 | 1407 | 131 | 0 | 3 | 1237 |
| 3 | 原始日志额外记录，触发步骤未独立核对 | UIA成功 | 175 | 197 | 165 | 107 | 78 | 未进入 | 未进入 | 未进入 |

样本1–2复现了约1.5–1.7秒的慢失败路径，不能当作正常成功取词的耗时。样本3说明旧版也存在较快的UIA成功路径；因操作上下文未完整核对，仅保留参考，不与前两次合并计算受控统计。不以小样本报告P95。

| 场景 | 修复前 | 修复后真实Windows数据 |
| --- | --- | --- |
| 记事本人工选词 | 上述两次受控慢失败及额外成功日志 | 未测，不能标记目标达成 |
| Edge/Chrome可复制HTML文本 | Edge人工页面已准备并确认可见选区；未取得有效快捷键对照数据 | 未测；浏览器URL安全校验导致自动化停止 |
| 无选区、连续真实按键、外部应用焦点 | 未形成完整受控样本 | 未测；仅有自动状态机/自有窗口检查 |
| 真实UIA超时、松键等待、剪贴板占用/恢复 | 取得复制失败路径数据，其余没有完整基线 | 未测；软超时恢复只做了模拟检查 |

本机证据保存在忽略的 `.cache/hotkey-perf-20261026/`，包括原始计时JSONL、measurement-summary.json、原构建副本与隔离profile。日志额外样本不丢弃，不以模拟数据补齐右列。

## 6. 实际回归

| 命令 | 结果与范围 |
| --- | --- |
| `npm run check` | 通过：Web/Desktop类型、ESLint、237项Web单元测试、Pages构建与子路径/manifest/SW/秘密模式检查 |
| `npm run test:desktop` | 23项通过：原15项及新增8项所有权、取消、软超时、退出重启和日志字段检查；时钟/子进程故障部分为模拟 |
| `npm run typecheck:desktop`、`npm run lint` | 最后代码检查通过 |
| `PLAYWRIGHT_CHANNEL=msedge npm run test:e2e -- --output reports/test-results/phase-4/hotkey-20261026/web --reporter list` | 33通过、3项既有跳过；独立Edge测试profile及人工同步响应，非当前用户浏览器/私库 |
| `npm run test:desktop:e2e -- --output reports/test-results/phase-4/hotkey-20261026/desktop-verified --reporter list` | 3通过、1项原有真实供应商请求跳过；真实Electron窗口/SQLite/注册冲突，选区与超时为人工注入 |
| 0.4.1便携exe自身启动/保存冒烟 | 通过：实际NSIS便携exe启动、快捷键注册、本机明确收藏1条人工记录、反馈页面及原生broker就绪、退出；不包含外部软件快捷键计时 |

初次桌面回归发现启动完成时序及多窗口选择竞态，已修复注册时机，测试改为按本机URL明确定位主窗口，保留原断言。另发现系统不允许注册Ctrl+Shift+D；通过独立Electron注册探针确认，回归改从应用原有组合选择可用项验证更换及重启。真实的另一Electron进程占键/失败保留旧键测试仍独立通过，没有把占用情况略去或伪报为可注册。失败输出及修复后的结果分目录保留。

## 7. 候选产物与打包

路径：`artifacts/desktop/hotkey-fix-0.4.1/Polar-Vocab-Capture-0.4.1-win-x64.exe`。未签名，仅本机生成，未发布Release、上传exe、推送或部署。

最终大小：100560969 字节。SHA256：`5831560eba00f7582b1ca5d56b9909f751e1e3fc50214c44ea54b87c19cdd85a`。

Electron44.9.0、builder26.15.3及其他依赖不变，不增加锁文件或新的下载库。第一次打包因Electron归档下载失败而停止，改用已有同版本 `node_modules/electron/dist`。本轮专用builder缓存由已有工具缓存复制；放在ESM项目内导致icons工具的CommonJS识别错误，增加缓存自己的 `package.json` 类型边界后重试，不修改第三方源码、不降低证书或签名保护。

实际离线打包命令：

```powershell
$env:ELECTRON_BUILDER_CACHE = Join-Path (Get-Location) '.cache/hotkey-perf-20261026/builder-cache'
npm run desktop:build
npx --no-install electron-builder --projectDir apps/desktop --config electron-builder.json --win portable --x64 --publish never --config.electronDist=../../node_modules/electron/dist --config.directories.output=../../artifacts/desktop/hotkey-fix-0.4.1
```

原0.4.0 exe、旧win-unpacked、SQLite队列、私库、历史报告、故障证据和原规划书均保留。对原0.4.0 exe、PROJECT_PLAN及原PHASE4_REPORT重新做了SHA256核对，未变化。测试始终指定新建的隔离数据目录，不清空日常AppData或旧验收profile。未运行iOS或真实GitHub同步。

## 8. 尚需完成的验收

恢复可用的Windows界面控制后，用同一人工词在记事本与Edge/Chrome分别补测冷/热路径、多次连续触发、无选区、切换焦点、按键未松开、剪贴板复杂格式/占用及超时。必须核对源码版本、最终exe哈希、原应用选区和剪贴板前后状态；分别报告首次反馈与取词完成数据，再判断200–300ms/1秒目标。此次不宣称性能修复全面验收完成，不进入其他新功能。

机制依据：[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window/)。接口说明不等于当前设备的性能证明。
