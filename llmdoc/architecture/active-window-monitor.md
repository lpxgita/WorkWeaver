# 焦点窗口监控组件架构

## 1. Identity
- **What:** macOS 状态栏工具 + CLI 组件，实时获取并显示当前焦点窗口名称。
- **Status:** 独立开发阶段，未集成进主项目。
- **Platform:** 仅 macOS（依赖 AppleScript / osascript + Electron Tray API）。

## 2. 技术方案
- **窗口信息获取:** 通过 `child_process.execFile` 调用 macOS 原生 `osascript`，执行 AppleScript 脚本。
- **状态栏显示:** 使用 Electron `Tray.setTitle()` macOS 专属 API，在菜单栏图标旁直接显示文本。
- **选型理由:** `get-windows` 为 ESM-only（不兼容 CommonJS）；`@paymoapp/active-window` 需 native 编译；AppleScript 零依赖且 macOS 原生支持。

## 3. 模块结构

| 文件 | 职责 |
|------|------|
| `active_window/tray-app.js` (`initApp`, `buildContextMenu`, `formatTrayTitle`) | Electron Tray 主进程，状态栏 UI、右键菜单、监控控制 |
| `active_window/main.js` (`main`, `parseArgs`, `runOnce`, `runMonitor`) | CLI 入口，参数解析，单次/持续两种运行模式 |
| `active_window/src/active-window-monitor.js` (`ActiveWindowMonitor`) | 核心类，继承 EventEmitter，轮询检测窗口变化 |
| `active_window/src/get-active-window.scpt` | AppleScript 脚本，多策略获取焦点窗口，返回 JSON |

## 4. 双入口架构

```
启动方式 1: npm start → electron tray-app.js → macOS 状态栏工具
启动方式 2: npm run cli → node main.js → 终端 CLI 输出
```

两个入口共享 `ActiveWindowMonitor` 核心类和 `.scpt` 脚本。

## 5. 状态栏工具（tray-app.js）

### 5.1 核心行为
- `app.dock.hide()` 隐藏 Dock 图标，成为纯状态栏工具。
- 每次 `poll` 事件触发时调用 `tray.setTitle()` 更新状态栏文本。
- 窗口变化时刷新右键菜单（更新历史记录）。

### 5.2 显示模式
- `full`: `应用名 — 窗口标题`（默认）
- `app`: 仅应用名
- `title`: 仅窗口标题

### 5.3 右键菜单功能
- 暂停/恢复监控
- 切换显示模式（完整/仅应用名/仅标题）
- 调整更新频率（500ms / 1s / 2s / 5s）
- 最大显示长度调节（30 / 60 / 100 / 不限）
- 最近 10 条窗口切换历史
- 监控统计（轮询次数、错误次数）
- 退出

### 5.4 配置项
| 配置 | 默认值 | 说明 |
|------|--------|------|
| `interval` | 1000 | 轮询间隔 ms |
| `maxTitleLength` | 60 | 状态栏最大显示字符数 |
| `displayMode` | `'full'` | 显示模式 |

## 6. ActiveWindowMonitor 类

- 继承 `EventEmitter`，事件驱动架构。
- **配置项:** `interval`（轮询间隔 ms，默认 1000）、`timeout`（osascript 超时 ms，默认 5000）、`maxHistorySize`（历史上限，默认 100）。
- **事件:** `start` / `stop` / `poll` / `change` / `error`。
- **窗口变化检测:** 比较 `app` + `title` 字段，变化时触发 `change` 事件并记录历史。
- **公开方法:** `getActiveWindow()`（单次获取）、`start()` / `stop()`（持续监控）、`getHistory()` / `getStatus()` / `clearHistory()`。

## 7. AppleScript 获取策略（按优先级）
1. `AXMain=true` 窗口的 `AXTitle` 属性
2. 第一个窗口的 `AXTitle`
3. 第一个窗口的 `name`
4. 第一个 `AXWindow` 角色元素的 `description`
5. 所有策略失败则返回空标题

## 8. WindowInfo 数据结构
- `app`: string — 应用进程名称
- `title`: string — 窗口标题（可能为空）
- `timestamp`: number — 获取时的毫秒时间戳

## 9. CLI 参数（main.js）
| 参数 | 短写 | 说明 |
|------|------|------|
| `--interval <ms>` | `-i` | 轮询间隔（最小 100ms） |
| `--once` | `-1` | 单次获取后退出 |
| `--duration <s>` | `-d` | 限时监控（秒） |
| `--changes-only` | `-c` | 仅输出窗口变化 |
| `--json` | `-j` | JSON 格式输出 |

## 10. macOS 权限要求
- **辅助功能（Accessibility）权限:** 获取窗口标题必须。
- **屏幕录制权限:** 部分 macOS 版本需要。

## 11. 依赖
- `electron` (devDependencies) — 仅 Tray 模式需要
- Node.js 内置模块 — CLI 模式零外部依赖

## 12. 设计决策
- **双入口:** Tray 模式（状态栏 GUI）与 CLI 模式共存，共享核心监控类。
- **纯状态栏工具:** 无窗口、无 Dock 图标，仅在 macOS 菜单栏显示。
- **事件驱动:** EventEmitter 模式方便 Tray 和 CLI 两种场景灵活订阅。
- **历史记录内存管理:** 通过 `maxHistorySize` 限制内存占用，FIFO 淘汰。
- **已部分集成:** `ai_summary/src/active-window-collector.js` 引用 `ActiveWindowMonitor` 类，在 AI 总结服务中持续采集焦点窗口信息并注入 prompt。Tray 模式仍独立运行。
