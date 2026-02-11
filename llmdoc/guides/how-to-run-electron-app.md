# 如何运行和打包 Electron 桌面应用

## 开发模式运行

1. **安装子模块依赖:** 确保 `auto_screenshot/` 和 `ai_summary/` 已运行过 `npm install`。

2. **安装 Electron 依赖:** 进入 `electron-app/` 目录，运行 `npm install`。

3. **确保配置文件存在:** 在 `work_monitor/` 根目录确认 `config.yaml` 存在。如果没有，复制 `config.example.yaml` 为 `config.yaml`。

4. **启动开发模式:**
   ```bash
   cd electron-app && npm start
   ```

5. **验证运行:** 应用窗口弹出后，可以看到仪表盘页面，显示截图服务和 AI 总结服务的状态卡片。

6. **功能验证:**
   - 点击「启动」按钮可启动/停止各服务
   - 切换到「截图服务」页面查看截图画廊
   - 切换到「AI 总结」页面选择日期和粒度查看总结
   - 切换到「配置」页面可编辑并保存配置
- 在「配置」页面可设置停止时间点（schedule.stop_times）
   - 切换到「日志」页面实时查看服务日志

## 打包为 macOS 应用

1. **安装所有依赖:**
   ```bash
   cd electron-app && npm install
   ```

2. **执行打包（自动安装子模块生产依赖）:**
   ```bash
   # 打包为 .dmg
   npm run build
   ```

3. **打包输出位置:** 在 `electron-app/dist/` 目录下：
   - `mac-arm64/Work Monitor.app` — macOS 应用包
   - `Work Monitor-*.dmg` — DMG 安装镜像

4. **安装应用:** 双击 `.dmg` 文件，将 `Work Monitor.app` 拖入 Applications 文件夹。

5. **首次打开:** 由于未签名，macOS 可能阻止打开。前往「系统设置 → 隐私与安全性」，点击「仍要打开」。

## 注意事项

- **Node.js 要求:** 打包后的应用自带 Electron 内置的 Node.js，无需用户单独安装。
- **配置文件路径:** 打包后配置文件位于 `Work Monitor.app/Contents/Resources/config.yaml`。
- **子模块位置:** 打包后子模块位于 `Work Monitor.app/Contents/Resources/auto_screenshot/` 和 `ai_summary/`。
- **代码签名:** 当前未配置 Apple Developer 证书。如需分发，需配置 `mac.identity` 和 notarization。
