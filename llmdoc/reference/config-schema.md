# 配置文件参考

## 1. Core Summary

Work Monitor 使用统一 YAML 配置文件（`work_monitor/config.yaml`）同时驱动 `auto_screenshot` 和 `ai_summary` 两个模块。配置分为共享段和模块独占段。两个模块也支持 `--legacy` 模式使用各自独立的 `config.yaml`。

## 2. 统一配置字段表

### 共享字段（两个模块同步读取）

| 配置项 | 类型 | 默认值 | 约束 | 说明 |
|--------|------|--------|------|------|
| `screenshot.interval` | number | 10 | 1-3600 | 截图间隔（秒），ai_summary 据此计算每分钟截图数 |
| `screenshot.format` | string | "jpeg" | jpeg/png/jpg | 图片格式，两个模块必须一致 |
| `schedule.enabled` | boolean | false | - | 启用时间限制 |
| `schedule.start_time` | string | "08:00" | HH:MM | 开始时间 |
| `schedule.end_time` | string | "22:00" | HH:MM | 结束时间 |
| `schedule.days` | array | Mon-Fri | Sun-Sat | 允许的工作日 |
| `schedule.stop_times` | array | [] | HH:MM | 停止时间点，到点后服务自动退出 |

### 仅 auto_screenshot 使用

| 配置项 | 类型 | 默认值 | 约束 | 说明 |
|--------|------|--------|------|------|
| `screenshot.quality` | number | 80 | 1-100 | JPEG 质量 |
| `screenshot.dimension` | number | 100 | 25/50/75/100 | 尺寸百分比 |
| `screenshot.monitors` | string/array | "all" | "all" 或索引数组 | 显示器选择 |
| `storage.directory` | string | "./screenshots" | - | 截图保存目录（ai_summary 自动读取此路径） |
| `storage.naming.pattern` | string | "{date}_{time}_{monitor}" | - | 命名模板（勿修改） |
| `storage.naming.date_format` | string | "YYYY-MM-DD" | - | 日期格式（勿修改） |
| `storage.naming.time_format` | string | "HH-mm-ss" | - | 时间格式（勿修改） |
| `storage.organize_by_date` | boolean | true | - | 按日期分目录（必须为 true） |

### 仅 ai_summary 使用

| 配置项 | 类型 | 默认值 | 约束 | 说明 |
|--------|------|--------|------|------|
| `gemini.api_key` | string | "" | 必填 | Google API Key |
| `gemini.model` | string | "gemini-3-flash-preview" | - | 模型名称 |
| `gemini.max_retries` | number | 3 | ≥0 | 重试次数 |
| `gemini.retry_delay` | number | 2 | - | 重试间隔（秒） |
| `summary.directory` | string | "./summaries" | - | 总结输出目录 |
| `summary.granularity.2min.enabled` | boolean | true | - | 启用2分钟总结 |
| `summary.granularity.2min.history_minutes` | number | 9 | - | 历史上下文分钟数 |
| `summary.granularity.10min.enabled` | boolean | true | - | 启用10分钟总结 |
| `summary.granularity.10min.history_count` | number | 5 | - | 历史上下文条数 |
| `summary.granularity.1h.enabled` | boolean | true | - | 启用1小时总结 |
| `summary.granularity.1h.recent_10min_count` | number | 6 | - | 最近10min条数 |
| `summary.granularity.1h.earlier_10min_count` | number | 6 | - | 更早10min条数 |

### 日志（各模块独立路径）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `logging.level` | string | "info" | 日志级别（共享） |
| `logging.console` | boolean | true | 控制台输出（共享） |
| `logging.screenshot_file` | string | "./logs/screenshot.log" | 截图服务日志 |
| `logging.summary_file` | string | "./logs/ai-summary.log" | 总结服务日志 |

## 3. 自动计算

- `screenshots_per_minute = 60 / screenshot.interval`（ai_summary 自动计算，无需手动配置）
- 2min 汇总的截图数量为 `2 * screenshots_per_minute`（由 `ai_summary/src/summary-scheduler.js:186-190` 计算）

## 4. Source of Truth
- **Primary Configuration:** `work_monitor/config.example.yaml` - 统一配置模板
- **Primary Code:** `auto_screenshot/src/config.js` (`Config.loadUnified`) / `ai_summary/src/config.js` (`Config.loadUnified`)
- **Legacy Configuration:** `auto_screenshot/config.example.yaml` / `ai_summary/config.example.yaml`
- **Related Architecture:** `/llmdoc/architecture/config-validation.md`
