# 报告与验收结果

阶段实施报告与自动生成的浏览器测试结果集中在这里，需求和技术文档另见 [docs](../docs/README.md)。

| 位置 | 内容 | 是否提交 |
| --- | --- | --- |
| [phase-0/PHASE0_REPORT.md](phase-0/PHASE0_REPORT.md) | Phase 0 实施、测试结果、未验证项目与风险 | 是 |
| [phase-1/PHASE1_REPORT.md](phase-1/PHASE1_REPORT.md) | Phase 1 本地词库、导入、备份与浏览器验收 | 是 |
| [phase-2/PHASE2_REPORT.md](phase-2/PHASE2_REPORT.md) | Phase 2 FSRS、卡片、学习任务与数据一致性验收 | 是 |
| [phase-3/PHASE3_REPORT.md](phase-3/PHASE3_REPORT.md) | Phase 3 私有同步、多端模拟与安全验收 | 是 |
| [phase-3.5/PHASE3_5_REPORT.md](phase-3.5/PHASE3_5_REPORT.md) | Phase 3.5 首次推送前检查及后续真实验收状态 | 是 |
| `test-results/` | 浏览器测试截图、失败trace及执行状态 | 否，自动生成 |
| `playwright-report/` | 可查看的HTML浏览器测试报告 | 否，自动生成 |

从项目根目录运行 `npm run test:e2e` 会更新后两类产物。查看报告：

```sh
npx playwright show-report reports/playwright-report
```

自动报告只证明这次测试所覆盖的行为，不能替代真机、远程部署或未实现功能的验收。源码、依赖和构建产物仍使用标准工程目录；启动方法见 [README](../README.md)。
