# 如何启动自动截图服务

1. **安装依赖:** 进入 `auto_screenshot/` 目录，运行 `npm install`。

2. **创建统一配置文件:** 在 `work_monitor/` 根目录，复制 `config.example.yaml` 为 `config.yaml`，按需修改参数。

3. **启动服务:** 使用统一配置（推荐，默认读 `../config.yaml`）：`cd auto_screenshot && node main.js`；指定统一配置路径：`node main.js --config /path/to/config.yaml`；向后兼容：`node main.js --legacy -c ./config.yaml`。

4. **验证运行:** 观察控制台输出，应包含：`加载配置文件: ../config.yaml (统一模式)`、`自动截图服务启动`、`调度器启动，截图间隔: 10 秒`、`截图保存: YYYY-MM-DD/xxxx.jpeg`。

5. **检查截图文件:** 在统一配置的 `storage.directory` 目录下查看生成的截图。

6. **停止服务:** 按 `Ctrl+C` 发送 SIGINT 信号，服务将等待当前截图完成后优雅退出。

7. **自动停止（可选）:** 配置 `schedule.stop_times` 后，服务会在下一次停止时间到达时自动退出。

8. **验证停止:** 控制台应显示：`收到 SIGINT/STOP_TIME 信号，正在关闭...`、`服务已停止`。
