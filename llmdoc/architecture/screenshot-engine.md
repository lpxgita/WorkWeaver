# 截图引擎与图像处理

## 1. Identity
- **What it is:** 封装 `screenshot-desktop` 与 `sharp` 的截图与图像处理模块，含截图清理功能。
- **Purpose:** 获取显示器列表、执行屏幕截图、按配置缩放图像、定期清理过期截图文件。

## 2. Core Components
- `auto_screenshot/src/screenshot.js` (`Screenshot`): 截图引擎类。
  - `listDisplays()`: 获取并缓存显示器列表。
  - `getTargetDisplays()`: 按 `monitors` 配置过滤显示器，附加从 1 开始的索引。
  - `capture(display)`: 调用 `screenshot-desktop` 截取单个显示器。
  - `process(imageBuffer)`: 使用 `sharp` 按 `dimension` 百分比缩放。
  - `captureAll()`: 遍历目标显示器，逐个截图+处理，返回 `[{display, buffer}]`。
- `auto_screenshot/src/cleaner.js` (`ScreenshotCleaner`): 截图清理模块。
  - `clean()`: 执行分级清理策略，返回 `{deleted_folders, thinned_folders, removed_files}`。
  - 清理规则：>30 天直接删除文件夹，7~30 天每分钟仅保留 1 张截图，<7 天不处理。
  - 天数阈值可通过 `storage.cleanup.delete_after_days` / `thin_after_days` 配置。

## 3. Execution Flow (LLM Retrieval Map)

```
captureAll()
  │
  ├─ 1. getTargetDisplays()
  │      ├─ listDisplays()  调用 screenshot-desktop，缓存结果
  │      └─ 按 monitors 配置过滤 + 添加 index
  │
  └─ 2. for each display:
         ├─ capture(display)
         │    └─ screenshot({ format, quality, screen: display.id })
         ├─ process(buffer)
         │    ├─ dimension >= 100 → 直接返回
         │    └─ dimension < 100 → sharp(buffer).resize({ width }).toBuffer()
         └─ push { display, buffer }
```

## 4. Design Rationale
- **显示器缓存:** `_displays` 缓存避免每次截图都查询系统显示器列表。
- **单个失败不影响整体:** `captureAll` 中单个显示器截图失败只记录错误，不中断其他。
- **按需处理:** 仅在 `dimension < 100` 时才调用 `sharp`，减少不必要的图像处理开销。
- **截图清理策略:** 三级分层清理（删除 / 稀疏 / 保留），在服务启动时自动异步执行（`auto_screenshot/main.js`），不阻塞截图流程。Electron 端通过 `screenshot:cleanup` IPC 支持手动触发。
- **稀疏保留逻辑:** 按文件名中的 `HH-mm` 部分分组，每分钟仅保留排序最前的一张，其余删除。适用于 10 秒间隔截图场景（同一分钟最多 6 张）。
