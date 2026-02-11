# 编码规范

## 1. Core Summary

项目未配置 ESLint / Prettier / EditorConfig 等格式化工具。以下规范从现有代码中推断得出，适用于 `auto_screenshot/` 子项目。

## 2. 推断规则

| 维度 | 规范 | 来源 |
|------|------|------|
| 语言 | Node.js (CommonJS) | `auto_screenshot/package.json`, 所有 `.js` 文件使用 `require/module.exports` |
| 缩进 | 4 空格 | 所有源文件一致使用 4 空格缩进 |
| 字符串 | 单引号 | `auto_screenshot/src/config.js`, `auto_screenshot/src/logger.js` 等 |
| 分号 | 有分号 | 所有源文件语句末尾使用分号 |
| 类风格 | ES6 Class | `Config`, `Logger`, `Storage`, `Screenshot`, `Scheduler` 均为 class |
| 注释语言 | 中文 | 所有注释与日志消息使用中文 |
| 文档注释 | JSDoc | 所有公开方法使用 JSDoc 注释（`@param`, `@returns`, `@throws`） |
| 错误处理 | try/catch + 日志 | 截图/存储错误记录日志后跳过，配置错误直接抛出终止 |
| 异步 | async/await | 所有异步操作使用 async/await，不使用回调链 |

## 3. Source of Truth
- **Primary Code:** `auto_screenshot/src/` - 所有模块源文件
- **Configuration:** `auto_screenshot/package.json` - 项目依赖与脚本定义
- **Related Architecture:** `/llmdoc/architecture/auto-screenshot-architecture.md`
