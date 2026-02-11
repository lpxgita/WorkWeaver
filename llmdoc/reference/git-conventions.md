# Git 规范

## 1. Core Summary

项目尚未初始化 Git 仓库，无法从 `git log` 推断现有提交风格。以下为推荐规范，供项目初始化 Git 后采用。

## 2. 推荐规范

### 分支策略
| 分支 | 用途 |
|------|------|
| `main` | 稳定版本，可运行 |
| `dev` | 开发分支，功能合入后合并到 main |
| `feat/<name>` | 功能分支，完成后合入 dev |
| `fix/<name>` | 修复分支 |

### 提交消息格式
```
<type>(<scope>): <简短描述>

[可选正文]
```

| type | 含义 |
|------|------|
| feat | 新功能 |
| fix | 修复 bug |
| refactor | 重构（不改变行为） |
| docs | 文档变更 |
| chore | 构建/配置/依赖变更 |
| test | 测试相关 |

**scope 示例:** `screenshot`, `scheduler`, `config`, `storage`, `logger`, `ai-summary`

### .gitignore 参考
`auto_screenshot/.gitignore` 已存在，建议在项目根目录补充：
- `node_modules/`
- `screenshots/`
- `logs/`
- `config.yaml`（含敏感路径/密钥）

## 3. Source of Truth
- **Configuration:** `auto_screenshot/.gitignore` - 现有忽略规则
- **Related Architecture:** `/llmdoc/overview/project-overview.md`
