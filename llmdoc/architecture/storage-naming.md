# 存储与命名策略

## 1. Identity
- **What it is:** 截图文件的目录管理、命名生成与写入模块。
- **Purpose:** 按日期归档截图，通过命名模板生成可读文件名，可靠保存图像数据。

## 2. Core Components
- `auto_screenshot/src/storage.js` (`Storage`): 存储类。
  - `ensureDirectory()`: 确保目标目录存在（支持按日期子目录）。
  - `generateFileName(monitorIndex)`: 按命名模板生成文件名。
  - `generateFilePath(monitorIndex)`: 组合目录+文件名。
  - `save(imageBuffer, filePath)`: 异步写入文件。
  - `getRelativePath(filePath)`: 生成相对路径用于日志。

## 3. Execution Flow (LLM Retrieval Map)

```
generateFilePath(monitorIndex)
  │
  ├─ 1. ensureDirectory()
  │      ├─ organize_by_date == true
  │      │    └─ baseDirectory/YYYY-MM-DD/
  │      └─ organize_by_date == false
  │           └─ baseDirectory/
  │      └─ fs.mkdirSync(recursive: true)
  │
  └─ 2. generateFileName(monitorIndex)
         ├─ 替换模板变量: {date} {time} {monitor} {timestamp}
         └─ 追加扩展名: .jpeg 或 .png
```

### 命名模板变量

| 变量 | 值 | 示例 |
|------|------|------|
| `{date}` | YYYY-MM-DD | 2026-02-05 |
| `{time}` | HH-mm-ss | 14-30-05 |
| `{monitor}` | 显示器索引 | 1 |
| `{timestamp}` | Unix 毫秒 | 1738762205000 |

### 默认路径示例
```
./screenshots/2026-02-05/2026-02-05_14-30-05_1.jpeg
```

## 4. Design Rationale
- **按日期分目录:** 避免单目录文件过多，便于按日期检索与清理。
- **相对/绝对路径兼容:** 构造函数中将相对路径转为绝对路径，后续操作统一使用绝对路径。
- **模板化命名:** 用户可通过配置自定义文件名格式，灵活适配不同需求。
