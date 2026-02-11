# WorkWeaver - 文档索引

## Overview（概览）
- [项目概览](overview/project-overview.md) - 项目定位、子系统组成、技术栈与目录结构

## Architecture（架构）
- [自动截图服务整体架构](architecture/auto-screenshot-architecture.md) - 模块组成、执行流程与设计决策
- [调度器与时间窗口限制](architecture/scheduling-time-window.md) - 定时调度、工作日/时间范围检查与关闭流程
- [截图引擎与图像处理](architecture/screenshot-engine.md) - 多显示器截图、图像缩放与错误隔离
- [存储与命名策略](architecture/storage-naming.md) - 日期归档、命名模板与文件写入
- [配置加载与校验](architecture/config-validation.md) - YAML 解析、默认值合并与参数校验
- [CLI 接口与运行生命周期](architecture/cli-lifecycle.md) - 参数解析、模块初始化顺序与优雅关闭
- [AI 总结模块架构](architecture/ai-summary-architecture.md) - Gemini API 集成、多粒度总结、跨时间聚合
- [Prompt 与 Output Schema 设计思路](architecture/prompt-schema-design.md) - 各粒度字段选择理由、浏览/操作区分、跨粒度聚合链路、与原始设计差异
- [Electron 桌面应用架构](architecture/electron-app-architecture.md) - 主进程/渲染进程分离、IPC 通信、服务进程管理与打包（含 Todo List 模块）
- [焦点窗口监控组件架构](architecture/active-window-monitor.md) - AppleScript 获取焦点窗口、事件驱动、独立组件设计

## Guides（操作指南）
- [如何启动截图服务](guides/how-to-run-screenshot-service.md) - 安装、配置、启动、验证与停止
- [如何配置截图服务](guides/how-to-configure-screenshot.md) - 各配置项说明与调整方法
- [如何启动 AI 总结服务](guides/how-to-run-ai-summary.md) - 安装、配置 API Key、启动与验证
- [如何运行和打包 Electron 桌面应用](guides/how-to-run-electron-app.md) - 开发模式运行、macOS 打包与安装
- [如何添加新模块](guides/how-to-add-new-module.md) - 以 AI 总结模块为例的扩展指南

## Reference（参考）
- [配置文件参考](reference/config-schema.md) - 完整字段表、类型、默认值与约束
- [编码规范](reference/coding-conventions.md) - 从代码推断的编码风格与约定
- [Git 规范](reference/git-conventions.md) - 推荐的分支策略与提交消息格式

## Agent（智能体报告）
- [系统级功能交接点评审报告（2026-02-10）](agent/系统级功能交接点评审报告-2026-02-10.md) - 从全局视角梳理模块交接点、核对焦点窗口时间线格式并给出分级改进方案

## Changelog（变更记录）
- [1.0.7（2026-02-11）](changelog/1.0.7.md) - 项目重命名为 WorkWeaver，创建 .gitignore，首次上传 GitHub
- [1.0.6（2026-02-10）](changelog/1.0.6.md) - 新增最新10分钟截图回放测试程序，支持当天不足回退前一天并输出完整测试产物
- [1.0.5（2026-02-10）](changelog/1.0.5.md) - category_name/category_type 列表化，移除 task_label，旧数据兼容策略
- [1.0.4（2026-02-10）](changelog/1.0.4.md) - 新增系统级功能交接点评审报告，补充跨模块交接点分析与改进建议
