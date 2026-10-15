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

Phase3.5已完成首次公开推送、正式站独立验收和真实私库A–E。F/G局部不变量通过，但旧版五轮整库同步发现删除修订不收敛；本地修复专项20/20、完整227项检查/构建及新E2E31通过/3跳过已完成，尚未部署，真实完整复验和H仍未完成。Actions attempt2 Success、iOS26.6第1–3及6/8通过为用户反馈，第4项导入部分通过，其余真机项目未知，不进入Phase4。

首次完整E2E重跑因旧输出目录误清理临时验收脚本、早期备份与acceptance JSONL而中止（退出1，未通过）。两端仍打开的数据已重新导出至上述 `.cache/` 位置，未损坏受跟踪原件或私库，未暴露PAT；不能声称旧临时原始产物仍完整保留。已观察工具结果仍如实记入 [Phase3.5报告](phase-3.5/PHASE3_5_REPORT.md)，逐项状态见[清单](../docs/REAL_DEVICE_CHECKLIST.md)。凭证、profile及恢复备份不纳入公开提交。
