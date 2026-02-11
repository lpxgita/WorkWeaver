# 配置加载与校验

## 1. Identity
- **What it is:** YAML 配置文件的加载、默认值合并与参数校验模块。
- **Purpose:** 将用户 YAML 配置转为验证后的运行时配置对象，驱动所有模块行为。

## 2. Core Components
- `auto_screenshot/src/config.js` (`Config`): 配置类。
  - `Config.load(configPath)`: 加载 YAML → 合并默认值 → 校验 → 返回配置对象。
  - `Config.mergeWithDefaults(userConfig)`: 深度合并用户配置与 `DEFAULT_CONFIG`。
  - `Config._deepMerge(target, source)`: 递归合并，数组直接覆盖，对象递归合并。
  - `Config.validate(config)`: 校验所有字段，收集错误后一次性抛出。
  - `Config.getDefaults()`: 返回默认配置的深拷贝。
- `auto_screenshot/config.example.yaml`: 配置文件模板与字段说明。

## 3. Execution Flow (LLM Retrieval Map)
- `auto_screenshot/src/config.js:55-89`（Config.loadUnified）加载统一配置并映射字段。
- `auto_screenshot/src/config.js:98-124`（Config.load）加载独立配置并合并默认值。
- `auto_screenshot/src/config.js:170-233`（Config.validate）校验 interval/format/quality/dimension/schedule/logging，并在错误汇总后抛出异常。
- `ai_summary/src/config.js:75-126`（Config.loadUnified）加载统一配置并计算 screenshots_per_minute。
- `ai_summary/src/config.js:221-270`（Config.validate）校验 gemini、interval、schedule、logging，并在错误汇总后抛出异常。

### 配置结构

| 配置段 | 关键字段 | 消费者 |
|--------|---------|--------|
| `screenshot` | interval, format, quality, dimension, monitors | `Screenshot`, `Scheduler` |
| `storage` | directory, naming, organize_by_date | `Storage` |
| `schedule` | enabled, start_time, end_time, days, stop_times | `Scheduler` |
| `logging` | level, file, console | `Logger` |

## 4. Design Rationale
- **默认值优先:** 用户只需配置需要修改的项，其余自动使用默认值。
- **收集式校验:** 一次返回所有校验错误，而非遇到第一个就中断。
- **YAML 格式:** 比 JSON 更适合人类编辑，注释友好。
