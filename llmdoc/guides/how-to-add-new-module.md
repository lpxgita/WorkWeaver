# 如何添加新模块

以 AI 总结模块为例，说明如何在 `work_monitor` 中添加新子模块。

1. **创建模块目录:** 在 `work_monitor/` 下新建目录，如 `ai_summary/`。

2. **初始化项目:** 在模块目录中运行 `npm init` 或手动创建 `package.json`。

3. **遵循现有编码规范:**
   - 使用 CommonJS (`require` / `module.exports`)。
   - ES6 Class 风格，JSDoc 注释，中文注释。
   - 参见 `/llmdoc/reference/coding-conventions.md`。

4. **设计模块接口:** 参考截图服务的模式：
   - 配置通过 YAML 文件驱动。
   - 对外暴露 Class，通过构造函数注入依赖。
   - 提供 `start()` / `stop()` 生命周期方法。

5. **与截图服务集成:**
   - 截图文件路径规则参见 `/llmdoc/architecture/storage-naming.md`。
   - AI 总结模块需读取 `storage.directory` 下按日期组织的截图文件。
   - AI 总结 Prompt 设计参见 `task/2.ai总结板块.md`。

6. **更新文档:** 在 `/llmdoc/` 中创建对应的 architecture 和 guide 文档。

7. **验证集成:** 确保新模块可独立启动测试，并能正确读取截图服务的输出。
