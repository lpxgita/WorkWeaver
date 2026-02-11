# 如何启动 AI 总结服务

1. **确保截图服务已运行:** AI 总结模块依赖 `auto_screenshot` 的截图输出。

2. **安装依赖:** 进入 `ai_summary/` 目录，运行 `npm install`。

3. **创建统一配置文件:** 在 `work_monitor/` 根目录，复制 `config.example.yaml` 为 `config.yaml`。

4. **配置 API Key:** 在统一 `config.yaml` 中填入 `gemini.api_key`（必填）。

5. **确认截图路径:** 统一配置中 `storage.directory` 同时作为截图保存目录和 AI 总结读取目录，无需手动对齐。

6. **启动服务:** 使用统一配置（推荐，默认读 `../config.yaml`）：`cd ai_summary && node main.js`；指定统一配置路径：`node main.js --config /path/to/config.yaml`；向后兼容：`node main.js --legacy -c ./config.yaml`。

7. **验证运行:** 观察控制台日志，应包含：`加载配置文件: ../config.yaml (统一模式)`、`[INFO ] AI 总结服务启动`、`[INFO ] 总结调度器启动`、`[INFO ] [2min] 开始总结...`、`[INFO ] [2min] 总结完成`、`[INFO ] 总结保存: 2min/YYYY-MM-DD/HH-mm.json`。

8. **查看总结结果:** 在 `summaries/` 目录下按 `日期/粒度/时间.json` 查看（基础粒度为 `2min`）。

9. **自动停止（可选）:** 配置 `schedule.stop_times` 后，服务会在下一次停止时间到达时自动退出。

10. **停止服务:** 按 `Ctrl+C`，服务将等待当前任务完成后退出。
