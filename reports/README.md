# 报告与验收结果

阶段实施报告与自动生成的浏览器测试结果集中在这里，需求和技术文档另见 [docs](../docs/README.md)。

| 位置 | 内容 | 是否提交 |
| --- | --- | --- |
| [phase-0/PHASE0_REPORT.md](phase-0/PHASE0_REPORT.md) | Phase 0 实施、测试结果、未验证项目与风险 | 是 |
| [phase-1/PHASE1_REPORT.md](phase-1/PHASE1_REPORT.md) | Phase 1 本地词库、导入、备份与浏览器验收 | 是 |
| [phase-2/PHASE2_REPORT.md](phase-2/PHASE2_REPORT.md) | Phase 2 FSRS、卡片、学习任务与数据一致性验收 | 是 |
| [phase-3/PHASE3_REPORT.md](phase-3/PHASE3_REPORT.md) | Phase 3 私有同步、多端模拟与安全验收 | 是 |
| [phase-3.5/PHASE3_5_REPORT.md](phase-3.5/PHASE3_5_REPORT.md) | Phase 3.5 首次推送、正式站与逐项真实验收状态 | 是 |
| `test-results/e2e/` | 可被测试运行清理的trace、截图及执行产物；不放真实验收备份或控制脚本 | 否，自动生成 |
| `playwright-report/` | 可查看的HTML浏览器测试报告 | 否，自动生成 |
| 工程根目录 `.cache/phase3.5-real-sync/` | 实时验收恢复后重新导出的本机备份，位于E2E输出清理范围之外 | 否，仅留本机，不发布 |

从项目根目录运行 `npm run test:e2e` 会更新 `test-results/e2e/` 和 `playwright-report/`，不会生成或替代真实验收备份。查看报告：

```sh
npx playwright show-report reports/playwright-report
```

自动报告只证明这次测试所覆盖的行为，不能替代真机、远程部署或未实现功能的验收。源码、依赖和构建产物仍使用标准工程目录；启动方法见 [README](../README.md)。

Phase3.5修复982b023普通push/[Actions](https://github.com/Polar0216/polar-vocab/actions/runs/38702050828)成功，元数据由API独立核对，原始日志未读。正式站A–G通过；H的幂等、进程恢复、收词/评分精确ACK、同profile标签锁、离线刷新及替代凭证重授权/最终收敛均通过，最终A/B各14词/3卡/5评分、共享表/SHA一致、pending/冲突/活动任务均0。真实401按用户选择保留未验证，H因此部分通过。iPhone1–3、6、8–10用户反馈通过，第4部分，第5/7/14未测，11–13真机同步由用户暂缓。本轮可执行部分结案，整体尚未完整验收，不进入Phase4。

首次完整E2E重跑因旧输出目录误清理临时验收脚本、早期备份与acceptance JSONL而中止（退出1，未通过）。两端仍打开的数据已重新导出至上述 `.cache/` 位置，未损坏受跟踪原件或私库，未暴露PAT；不能声称旧临时原始产物仍完整保留。已观察工具结果仍如实记入 [Phase3.5报告](phase-3.5/PHASE3_5_REPORT.md)，逐项状态见[清单](../docs/REAL_DEVICE_CHECKLIST.md)。凭证、profile及恢复备份不纳入公开提交。

旧profile更新AbortError失败保留历史，新profile正常UI恢复原记录不当正常SW通过。H门闩控制工具曾Route already handled中断，原批次/后写pending重启恢复后，修正忽略的工具并重新测试收词/评分ACK通过，旧失败不抹掉。控制脚本在忽略的 `reports/test-results/live-controls/`，备份/profile在E2E清理范围外；终态检查25份JSON、21份完整备份及19个匹配SHA的canonical远端基线，无识别凭证/远端local-only字段且均被忽略。后续用户在聊天主动提供两枚测试凭证并明确授权临时测试使用，凭证未写入项目、备份或公开产物，验收结束后需用户撤销；安全事件如实记入阶段报告，不保存值或片段。控制器已关闭并确认进程退出、Node REPL内存已reset，不替代远端撤销。
