# Capture 0.6.1 授权窗口修复

日期：2026-10-27。公开Web仍为0.6.0；此修复只影响桌面授权窗口，不改变采集协议、FSRS、数据目录或Windows凭证键。

## 观察与范围

用户在网页版完成配置后尝试桌面连接，截图显示“请完成系统授权窗口…”且其余授权按钮禁用。实际0.6.0状态为checking/未连接，CredentialHelper进程存在、MainWindowHandle为0，没有可见授权窗；十分钟后转credential-error。没有读取用户凭证，没有私库请求或上传；当前桌面0事件/0批次，已另存一致性在线备份。

网页会话和桌面授权独立。网页版连接不能代替桌面原生输入；不会从网页提取PAT给桌面。

初步怀疑windowsHide同时影响第一次WinForms显示：[libuv](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/process.c)与[ShowWindow文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)支持这种可能。但本机无凭证诊断对照中，console/GUI子系统在windowsHide:true下都能显示，**未复现这一假设，不能把它当作已证明的唯一根因**。最初口头判断过于确定，已更正；旧失败结果保留。

## 修复

- CredentialHelper编译为GUI子系统，避免另开控制台；交互prompt不使用windowsHide，后台凭证操作保持隐藏。
- 无控制台时不用Console.InputEncoding/OutputEncoding的代码页API；显式UTF-8匿名stdin/stdout/stderr管道，初始化放在异常边界内。
- 原生窗先检查自己的native可见性，必要时重新显示，再报告固定就绪标记，不包含Token或输入内容。
- 8秒没有就绪标记即终止本次子进程并返回固定窗口错误；只有正常显示后才等待用户输入，避免十分钟无反馈。
- 等待期间增加“取消授权输入”；旧请求取消后不覆盖新授权，不把取消误报为凭证管理器错误。
- 保留原Windows安全存储、目标绑定、最小权限、事件身份和队列。未升级/重写私人数据。

## 实际测试

- 最终TS/ESLint/desktop:build通过。
- `npm run test:desktop`：11文件76项通过，包括真实Windows凭证管理器人工值读写删除、窗口可见性/Unicode管道、8秒无就绪超时、取消恢复。Windows以外真实原生项按原规则跳过。
- `npm run test:desktop:e2e -- --reporter list --output reports/test-results/integrated/auth-popup-0.6.1-regression-final`：7通过、2显式联网项默认跳过；包括真正Electron主进程启动无凭证诊断GUI、实际native可见性、Unicode/取消重试，以及旧收词/SQLite/整句回归。
- 诊断fixture没有密码框、凭证访问或网络，只观察自己的窗口后自动关闭；没有自动操作用户授权对话框。
- 第一轮WinExe转换因Console代码页调用失败，随后改显式流后通过；同轮迁移测试有一次Windows目录rename EPERM，最终完整重跑9项迁移通过。失败没有抹掉或算为通过。
- 实际正式Pages上的v1/结构化v2/句子v2接收测试另6/6通过（29.3秒）。真实部署网页，GitHub全部FakeGitHub拦截、全新浏览器context、serviceWorkers=block；不能称为真实私库或离线/SW运行验收，也没有动用户已配置的网页会话。

## 产物与待验收

修复版位于`artifacts/desktop/integrated-0.6.1-final/Polar-Vocab-Capture-0.6.1-win-x64.exe`；早期本轮候选包在`integrated-0.6.1/`也保留。0.6.0与其他旧程序和报告、全部SQLite测试资料均未清理。

最终便携版已构建并真正从SFX启动（不是unpacked冒充）：100607766字节，SHA256 `3d0730e2a535ecbaff1ff09d90fc415e4e54f4ae8aff3fbb32d4607bda1d1229`。实际版本0.6.1，正式数据目录/快捷键成功，0事件0批次与启动前一致，自动上传false。旧0.6.0正常退出，网页会话没有关闭。当前已交给用户本人完成原生输入；连接成功与真实私库结果尚待核对。原生诊断窗成功不等于生产授权窗、真实PAT或真实私库验收成功。iOS仍不执行；完整真实同步链路仍等桌面授权，不能使用聊天历史泄露凭证。
