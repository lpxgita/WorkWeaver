# 如何配置截图服务

1. **复制统一配置模板:** 将 `work_monitor/config.example.yaml` 复制为 `config.yaml`。
   - 统一配置同时驱动 `auto_screenshot` 和 `ai_summary`，共享字段自动同步。

2. **调整截图间隔:** 修改 `screenshot.interval`（单位：秒，范围 1-3600）。
   - AI 总结模块会自动计算 `screenshots_per_minute = 60 / interval`。
   - 默认 10 秒，对应每分钟 6 张截图。

3. **选择图片格式与质量:**
   - `screenshot.format`: `jpeg`（体积小） 或 `png`（无损）。共享字段，两个模块自动一致。
   - `screenshot.quality`: 1-100，仅对 JPEG 生效（推荐 60-80）。

4. **配置图像缩放:** `screenshot.dimension` 设为 25/50/75/100（百分比）。
   - 值 < 100 时使用 `sharp` 缩放，可显著减小文件体积。

5. **配置存储路径:**
   - `storage.directory`: 支持相对路径（相对于配置文件所在目录）或绝对路径。
   - AI 总结模块自动从此路径读取截图，无需手动对齐。
   - **重要:** `storage.organize_by_date` 必须为 `true`，`storage.naming.pattern` 保持默认 `{date}_{time}_{monitor}`。

6. **配置时间限制（可选）:**
   - `schedule.enabled`: 设为 `true` 启用。共享字段，两个模块同步生效。
   - `schedule.start_time` / `schedule.end_time`: HH:MM 格式。
   - `schedule.days`: 允许的工作日列表。
   - `schedule.stop_times`: 停止时间点列表，到点后服务自动退出（与时间限制独立）。

7. **验证配置:** 启动服务，若配置有误将在启动时抛出详细错误信息。
   - 校验逻辑参见 `auto_screenshot/src/config.js` (`Config.validate`) 和 `ai_summary/src/config.js` (`Config.validate`)。
