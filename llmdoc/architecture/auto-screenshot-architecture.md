# 自动截图服务 - 整体架构

## 1. Identity
- **What it is:** 基于 Node.js 的命令行截图服务。
- **Purpose:** 按固定间隔截取屏幕，按日期归档存储截图，为 AI 总结模块提供数据源。

## 2. Core Components

| 模块 | 文件 | 职责 |
|------|------|------|
| 主入口 | `auto_screenshot/main.js` (`main`, `parseArgs`, `shutdown`) | CLI 参数解析、模块装配、生命周期管理 |
| 配置 | `auto_screenshot/src/config.js` (`Config`) | YAML 加载、默认值合并、参数校验 |
| 截图引擎 | `auto_screenshot/src/screenshot.js` (`Screenshot`) | 多显示器截图、图像缩放 |
| 调度器 | `auto_screenshot/src/scheduler.js` (`Scheduler`) | 定时执行、时间窗口/工作日限制、并发控制 |
| 存储 | `auto_screenshot/src/storage.js` (`Storage`) | 目录创建、命名模板、文件保存 |
| 日志 | `auto_screenshot/src/logger.js` (`Logger`) | 多级别日志、控制台+文件输出 |

## 3. Execution Flow (LLM Retrieval Map)

```
启动 → main.js
  │
  ├─ 1. parseArgs()           解析 --config/-c 等参数
  ├─ 2. Config.load()         加载 YAML → 合并默认值 → 校验
  ├─ 3. new Logger()          初始化日志（控制台+文件）
  ├─ 4. new Storage()         初始化存储（解析目录路径）
  ├─ 5. new Screenshot()      初始化截图引擎（格式/质量/尺寸）
  ├─ 6. new Scheduler()       注入所有模块
  ├─ 7. process.on(SIGINT/SIGTERM) → shutdown()
  └─ 8. scheduler.start()
           │
           ├─ 立即执行 executeTask()
           └─ setInterval(executeTask, interval)
                │
                ├─ isAllowed()        时间窗口+工作日检查
                ├─ screenshot.captureAll()  遍历显示器截图+缩放
                └─ storage.save()     生成路径+写入文件
```

## 4. Design Rationale
- **CLI 而非 GUI:** 去除 Electron 依赖，体积从 ~200MB 降至 ~50MB，便于后台运行。
- **配置驱动:** 所有行为通过 YAML 配置控制，支持灵活调整而无需改代码。
- **模块解耦:** 各模块通过构造函数注入，职责单一，便于独立测试与扩展。
- **优雅关闭:** 等待当前截图完成后再退出，避免数据损坏。
