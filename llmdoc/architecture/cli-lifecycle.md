# CLI 接口与运行生命周期

## 1. Identity
- **What it is:** 命令行入口与服务生命周期管理。
- **Purpose:** 解析 CLI 参数、按正确顺序初始化模块、注册信号处理实现优雅关闭。

## 2. Core Components
- `auto_screenshot/main.js` (`main`, `parseArgs`, `showHelp`, `shutdown`): 入口脚本。

## 3. Execution Flow (LLM Retrieval Map)

### 启动流程
```
node main.js [--config path]
  │
  ├─ 1. parseArgs(process.argv)
  │      ├─ --help/-h    → showHelp() → exit(0)
  │      ├─ --version/-v → print version → exit(0)
  │      └─ --config/-c  → 设置配置路径（默认 ./config.yaml）
  │
  ├─ 2. process.chdir(scriptDir)  切换到脚本所在目录
  │
  ├─ 3. Config.load(args.config)  加载配置
  ├─ 4. new Logger(config.logging)
  ├─ 5. new Storage(config.storage, config.screenshot.format)
  ├─ 6. new Screenshot(config.screenshot)
  ├─ 7. new Scheduler({ config, screenshot, storage, logger })
  │
  ├─ 8. process.on('SIGINT', shutdown)
  │     process.on('SIGTERM', shutdown)
  │
  └─ 9. scheduler.start()  → 进入定时循环
```

### 关闭流程
```
收到 SIGINT / SIGTERM
  │
  ├─ 1. logger.info('收到信号，正在关闭...')
  ├─ 2. scheduler.stop()
  │      ├─ clearInterval()
  │      └─ 等待 isExecuting == false
  ├─ 3. logger.info('服务已停止')
  ├─ 4. logger.close()  关闭文件写入流
  └─ 5. process.exit(0)
```

### 错误处理
```
启动阶段异常 (配置错误等)
  │
  ├─ logger 已初始化 → logger.error() + logger.close()
  └─ logger 未初始化 → console.error()
  └─ process.exit(1)

未捕获的 Promise 异常
  └─ main().catch() → console.error() → exit(1)
```

## 4. Design Rationale
- **工作目录切换:** `process.chdir(scriptDir)` 确保相对路径相对于脚本位置而非调用位置。
- **初始化顺序:** Logger 最先初始化，确保后续模块的错误都能被记录。
- **双层错误处理:** try/catch 捕获同步错误，`.catch()` 捕获未预期的异步错误。
