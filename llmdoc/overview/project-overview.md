# WorkWeaver - 项目概览

## 1. Identity
- **What it is:** 一个基于屏幕截图与 AI 总结的工作活动监控系统。
- **Purpose:** 定时截取用户屏幕，并通过多时间粒度（2 分钟 / 10 分钟 / 1 小时）的 AI 总结，自动记录与归纳用户的工作活动。

## 2. High-Level Description

Work Monitor 由三大子系统和一个独立组件组成：

1. **自动截图服务 (`auto_screenshot/`)**：Node.js CLI 服务，通过 YAML 配置驱动，按固定间隔截取屏幕并按日期归档存储。支持多显示器、时间窗口/工作日限制、图像缩放与优雅关闭。
2. **AI 总结模块 (`ai_summary/`)**：Node.js CLI 服务，读取截图数据，调用 Google Gemini API 按 2min / 10min / 1h 三个粒度生成结构化 JSON 总结，输出任务标签、动作、进度、阻塞等字段，支持跨时间粒度串联聚合。
3. **Electron 桌面应用 (`electron-app/`)**：图形化桌面客户端，统一管理截图服务与 AI 总结服务的启动/停止，提供仪表盘、截图画廊、AI 总结浏览、配置编辑、实时日志查看等功能。支持打包为 macOS 原生应用（.app / .dmg）。
4. **焦点窗口监控 (`active_window/`)**：macOS 状态栏工具 + CLI 双入口。通过 AppleScript 获取焦点窗口信息，使用 Electron Tray.setTitle() 在菜单栏实时显示窗口名称。支持显示模式切换、频率调节、历史记录。核心 `ActiveWindowMonitor` 类已集成进 AI 总结模块（`ai_summary/src/active-window-collector.js`），在各粒度 prompt 中注入焦点窗口时间线。

## 3. Tech Stack
- **Runtime:** Node.js
- **截图:** `screenshot-desktop` (跨平台屏幕截图)
- **图像处理:** `sharp` (缩放/格式转换)
- **配置:** `yaml` (YAML 解析)
- **AI 集成:** Google Gemini API (`@google/genai`)
- **桌面应用:** Electron (跨平台桌面框架)
- **打包工具:** electron-builder (macOS .app / .dmg 打包)

## 4. Project Structure
```
work_monitor/
├── config.yaml               # 统一配置文件（驱动两个模块）
├── config.example.yaml        # 统一配置模板
├── auto_screenshot/          # 自动截图服务（已实现）
│   ├── main.js               # CLI 入口（默认读 ../config.yaml）
│   ├── package.json           # 依赖与脚本
│   ├── config.example.yaml    # 模块独立配置示例（--legacy 模式）
│   ├── ARCHITECTURE.md        # 架构设计文档
│   ├── DESIGN.md              # 详细设计文档
│   └── src/
│       ├── config.js          # 配置加载（支持 loadUnified + load）
│       ├── screenshot.js      # 截图引擎
│       ├── scheduler.js       # 定时调度器
│       ├── storage.js         # 文件存储
│       └── logger.js          # 日志模块
├── ai_summary/               # AI 总结服务（已实现骨架）
│   ├── main.js               # CLI 入口（默认读 ../config.yaml）
│   ├── package.json           # 依赖与脚本
│   ├── config.example.yaml    # 模块独立配置示例（--legacy 模式）
│   ├── ARCHITECTURE.md        # 架构设计文档
│   └── src/
│       ├── config.js          # 配置加载（支持 loadUnified + load）
│       ├── gemini-client.js   # Gemini API 封装
│       ├── screenshot-reader.js # 截图文件检索
│       ├── summary-store.js   # 总结结果存储
│       ├── prompt-builder.js  # 提示词构建（含焦点窗口注入）
│       ├── summary-scheduler.js # 总结调度器（串联窗口采集与 prompt 日志）
│       ├── active-window-collector.js # 焦点窗口数据采集器
│       ├── active-window-monitor.js # 内置焦点窗口监控器（打包兼容）
│       ├── get-active-window.scpt # AppleScript 脚本（内置）
│       ├── prompt-logger.js   # Prompt 日志记录器
│       ├── screenshot-comparer.js # 截图比对器（无变化跳过 API）
│       └── logger.js          # 日志模块
├── electron-app/              # Electron 桌面应用
│   ├── main.js               # Electron 主进程（窗口管理、IPC）
│   ├── preload.js            # 预加载脚本（安全 API 桥接）
│   ├── package.json          # 依赖与 electron-builder 打包配置
│   ├── service-manager.js    # 服务进程管理（启动/停止子进程）
│   ├── config-manager.js     # 配置文件读写
│   ├── summary-reader.js     # 总结与截图数据读取
│   ├── scripts/
│   │   └── install-deps.js   # 打包前安装子模块依赖
│   ├── todo-store.js         # Todo 数据存储（任务+行为 CRUD，JSON 持久化）
│   └── renderer/
│       ├── index.html        # 界面布局（7 个页面）
│       ├── styles.css        # 深色主题样式
│       └── app.js            # 前端交互逻辑
├── active_window/             # 焦点窗口监控（独立组件，未集成）
│   ├── tray-app.js            # Electron Tray 主进程（状态栏工具）
│   ├── main.js               # CLI 入口（单次/持续监控模式）
│   ├── package.json           # 模块配置（Electron devDep）
│   └── src/
│       ├── active-window-monitor.js  # 核心类（EventEmitter）
│       └── get-active-window.scpt    # AppleScript 脚本
├── task/                      # 项目任务文档
│   ├── 1. 初始目标.md
│   ├── 2.ai总结板块.md        # AI 总结模块设计
│   └── 谷歌生成参考.md        # Google API 参考
└── llmdoc/                    # LLM 文档系统
```
