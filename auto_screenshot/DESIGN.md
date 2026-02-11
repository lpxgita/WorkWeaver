# 自动截图服务 - 详细设计文档

## 1. 模块详细设计

### 1.1 配置模块 (src/config.js)

#### 职责
- 加载 YAML 配置文件
- 验证配置参数
- 提供默认值
- 支持命令行参数覆盖

#### 接口设计

```javascript
/**
 * 配置模块
 */
class Config {
    /**
     * 从文件加载配置
     * @param {string} configPath - 配置文件路径
     * @returns {Object} 配置对象
     * @throws {Error} 配置文件不存在或格式错误
     */
    static load(configPath) {}

    /**
     * 验证配置
     * @param {Object} config - 配置对象
     * @returns {Object} 验证后的配置（含默认值）
     * @throws {Error} 配置验证失败
     */
    static validate(config) {}

    /**
     * 获取默认配置
     * @returns {Object} 默认配置对象
     */
    static getDefaults() {}
}
```

#### 默认配置

```javascript
const DEFAULT_CONFIG = {
    screenshot: {
        interval: 5,
        format: 'jpeg',
        quality: 80,
        dimension: 100,
        monitors: 'all'
    },
    storage: {
        directory: './screenshots',
        naming: {
            pattern: '{date}_{time}_{monitor}',
            date_format: 'YYYY-MM-DD',
            time_format: 'HH-mm-ss'
        },
        organize_by_date: true
    },
    schedule: {
        enabled: false,
        start_time: '08:00',
        end_time: '22:00',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    },
    logging: {
        level: 'info',
        file: './logs/screenshot.log',
        console: true
    }
};
```

---

### 1.2 日志模块 (src/logger.js)

#### 职责
- 格式化日志输出
- 支持多级别日志 (debug/info/warn/error)
- 同时输出到控制台和文件

#### 接口设计

```javascript
/**
 * 日志模块
 */
class Logger {
    /**
     * 创建日志实例
     * @param {Object} options - 日志配置
     * @param {string} options.level - 日志级别
     * @param {string} options.file - 日志文件路径
     * @param {boolean} options.console - 是否输出到控制台
     */
    constructor(options) {}

    debug(message, ...args) {}
    info(message, ...args) {}
    warn(message, ...args) {}
    error(message, ...args) {}

    /**
     * 关闭日志流
     */
    close() {}
}
```

#### 日志格式

```
[YYYY-MM-DD HH:mm:ss] [LEVEL] message
```

示例：
```
[2026-02-05 14:30:00] [INFO] 自动截图服务启动
[2026-02-05 14:30:00] [DEBUG] 加载配置: ./config.yaml
[2026-02-05 14:30:05] [ERROR] 截图失败: Display not found
```

---

### 1.3 存储模块 (src/storage.js)

#### 职责
- 创建保存目录
- 生成文件名
- 保存截图文件

#### 接口设计

```javascript
/**
 * 存储模块
 */
class Storage {
    /**
     * 创建存储实例
     * @param {Object} config - 存储配置
     */
    constructor(config) {}

    /**
     * 确保目录存在
     * @returns {string} 当前保存目录路径
     */
    ensureDirectory() {}

    /**
     * 生成文件名
     * @param {number} monitorIndex - 显示器索引
     * @returns {string} 完整文件路径
     */
    generateFilePath(monitorIndex) {}

    /**
     * 保存截图
     * @param {Buffer} imageBuffer - 图像数据
     * @param {string} filePath - 文件路径
     * @returns {Promise<void>}
     */
    async save(imageBuffer, filePath) {}
}
```

#### 文件命名规则

| 模式变量 | 说明 | 示例 |
|----------|------|------|
| `{date}` | 日期 | 2026-02-05 |
| `{time}` | 时间 | 14-30-05 |
| `{monitor}` | 显示器编号 | 1, 2, 3 |
| `{timestamp}` | Unix 时间戳 | 1738762205 |

默认命名: `{date}_{time}_{monitor}.jpeg`
示例: `2026-02-05_14-30-05_1.jpeg`

---

### 1.4 截图引擎 (src/screenshot.js)

#### 职责
- 获取显示器列表
- 执行屏幕截图
- 调整图像尺寸和质量

#### 接口设计

```javascript
/**
 * 截图引擎
 */
class Screenshot {
    /**
     * 创建截图引擎实例
     * @param {Object} config - 截图配置
     */
    constructor(config) {}

    /**
     * 获取显示器列表
     * @returns {Promise<Array>} 显示器数组
     */
    async listDisplays() {}

    /**
     * 截取单个显示器
     * @param {Object} display - 显示器对象
     * @returns {Promise<Buffer>} 图像数据
     */
    async capture(display) {}

    /**
     * 处理图像（调整尺寸）
     * @param {Buffer} imageBuffer - 原始图像
     * @returns {Promise<Buffer>} 处理后的图像
     */
    async process(imageBuffer) {}

    /**
     * 截取所有配置的显示器
     * @returns {Promise<Array<{display: Object, buffer: Buffer}>>}
     */
    async captureAll() {}
}
```

#### 图像处理流程

```
原始截图 (Buffer)
    │
    ▼
┌─────────────────┐
│ 检查尺寸设置    │
│ dimension < 100?│
└────────┬────────┘
         │
    ┌────┴────┐
    │ Yes     │ No
    ▼         ▼
┌───────┐  ┌───────┐
│ sharp │  │ 直接  │
│ resize│  │ 返回  │
└───┬───┘  └───┬───┘
    │          │
    └────┬─────┘
         ▼
   返回处理后的 Buffer
```

---

### 1.5 调度器 (src/scheduler.js)

#### 职责
- 管理定时任务
- 执行条件检查（时间、工作日）
- 协调截图和存储

#### 接口设计

```javascript
/**
 * 调度器
 */
class Scheduler {
    /**
     * 创建调度器实例
     * @param {Object} options
     * @param {Object} options.config - 完整配置
     * @param {Screenshot} options.screenshot - 截图引擎
     * @param {Storage} options.storage - 存储模块
     * @param {Logger} options.logger - 日志模块
     */
    constructor(options) {}

    /**
     * 启动调度器
     */
    start() {}

    /**
     * 停止调度器
     * @returns {Promise<void>} 等待当前任务完成
     */
    async stop() {}

    /**
     * 检查是否允许截图
     * @returns {boolean}
     */
    isAllowed() {}

    /**
     * 检查是否为允许的工作日
     * @returns {boolean}
     */
    isAllowedDay() {}

    /**
     * 检查是否在允许的时间范围内
     * @returns {boolean}
     */
    isWithinAllowedTime() {}

    /**
     * 执行一次截图任务
     * @returns {Promise<void>}
     */
    async executeTask() {}
}
```

#### 状态管理

```javascript
// 调度器状态
{
    isRunning: boolean,      // 是否正在运行
    isExecuting: boolean,    // 是否正在执行截图
    intervalId: number,      // 定时器 ID
    lastExecuteTime: Date,   // 上次执行时间
    executeCount: number     // 执行次数
}
```

---

### 1.6 主入口 (main.js)

#### 职责
- 解析命令行参数
- 初始化所有模块
- 注册信号处理
- 启动服务

#### 流程

```javascript
async function main() {
    // 1. 解析命令行参数
    const args = parseArgs(process.argv);
    
    // 2. 加载配置
    const config = Config.load(args.config || './config.yaml');
    
    // 3. 初始化模块
    const logger = new Logger(config.logging);
    const storage = new Storage(config.storage);
    const screenshot = new Screenshot(config.screenshot);
    const scheduler = new Scheduler({ config, screenshot, storage, logger });
    
    // 4. 注册信号处理
    process.on('SIGINT', async () => {
        logger.info('收到 SIGINT，正在停止...');
        await scheduler.stop();
        logger.close();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        logger.info('收到 SIGTERM，正在停止...');
        await scheduler.stop();
        logger.close();
        process.exit(0);
    });
    
    // 5. 启动服务
    logger.info('自动截图服务启动');
    scheduler.start();
}
```

---

## 2. 数据流设计

### 2.1 配置数据流

```
config.yaml
    │
    ▼
┌─────────────┐
│ Config.load │
└──────┬──────┘
       │
       ▼
┌──────────────┐
│ Config.      │
│ validate     │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│ screenshot   │     │ storage      │
│ config       │     │ config       │
└──────┬───────┘     └──────┬───────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│ Screenshot   │     │ Storage      │
│ instance     │     │ instance     │
└──────────────┘     └──────────────┘
```

### 2.2 截图数据流

```
Scheduler.executeTask()
    │
    ▼
Screenshot.captureAll()
    │
    ├──► Display 1 ──► Buffer 1
    ├──► Display 2 ──► Buffer 2
    └──► Display N ──► Buffer N
    │
    ▼
Screenshot.process() (如需调整尺寸)
    │
    ▼
Storage.save()
    │
    ▼
文件系统
./screenshots/2026-02-05/
    ├── 2026-02-05_14-30-05_1.jpeg
    ├── 2026-02-05_14-30-05_2.jpeg
    └── ...
```

---

## 3. 错误处理设计

### 3.1 错误分类

| 错误类型 | 处理方式 | 示例 |
|----------|----------|------|
| 配置错误 | 启动失败，退出 | 配置文件不存在 |
| 截图错误 | 记录日志，跳过 | 显示器不可用 |
| 存储错误 | 记录日志，跳过 | 磁盘空间不足 |
| 系统错误 | 记录日志，尝试继续 | 临时资源不可用 |

### 3.2 错误处理策略

```javascript
// 截图错误处理
async executeTask() {
    try {
        const captures = await this.screenshot.captureAll();
        for (const { display, buffer } of captures) {
            try {
                const filePath = this.storage.generateFilePath(display.index);
                await this.storage.save(buffer, filePath);
                this.logger.info(`截图保存: ${filePath}`);
            } catch (saveError) {
                // 存储错误：记录日志，继续处理其他截图
                this.logger.error(`保存失败: ${saveError.message}`);
            }
        }
    } catch (captureError) {
        // 截图错误：记录日志，等待下次执行
        this.logger.error(`截图失败: ${captureError.message}`);
    }
}
```

---

## 4. 测试设计

### 4.1 单元测试

| 模块 | 测试用例 |
|------|----------|
| Config | 加载有效配置、加载无效配置、默认值合并 |
| Logger | 各级别日志输出、文件写入 |
| Storage | 目录创建、文件命名、文件保存 |
| Screenshot | 显示器列表、截图执行、图像处理 |
| Scheduler | 时间检查、工作日检查、任务执行 |

### 4.2 集成测试

| 场景 | 验证点 |
|------|--------|
| 正常启动 | 配置加载、模块初始化、首次截图 |
| 时间限制 | 时间范围内截图、范围外跳过 |
| 优雅关闭 | SIGINT 处理、任务完成后退出 |
| 错误恢复 | 截图失败后继续运行 |

---

## 5. 实现优先级

### Phase 1: 核心功能 (MVP)
1. [x] 架构设计文档
2. [ ] 配置模块 (Config)
3. [ ] 日志模块 (Logger) 
4. [ ] 截图引擎 (Screenshot)
5. [ ] 存储模块 (Storage)
6. [ ] 调度器 (Scheduler)
7. [ ] 主入口 (main.js)

### Phase 2: 增强功能
1. [ ] 命令行参数解析
2. [ ] 配置验证增强
3. [ ] 多显示器选择
4. [ ] 日志轮转

### Phase 3: 扩展功能
1. [ ] 热重载配置
2. [ ] HTTP API 接口
3. [ ] 截图事件回调
4. [ ] 性能优化

---

## 6. 参考实现

### 6.1 从 Electron 版本提取的核心逻辑

以下函数可直接复用或稍作修改：

| 原函数 | 位置 | 复用方式 |
|--------|------|----------|
| `getCurrentDateFolder()` | main.js:143-149 | 直接复用 |
| `getTimeString()` | main.js:151-157 | 直接复用 |
| `isAllowedDay()` | main.js:159-166 | 修改为从配置读取 |
| `isWithinAllowedTime()` | main.js:168-177 | 修改为从配置读取 |
| `takeScreenshot()` | main.js:179-205 | 拆分为 Screenshot + Storage |

### 6.2 核心依赖使用示例

```javascript
// screenshot-desktop 使用
const screenshot = require('screenshot-desktop');

// 获取显示器列表
const displays = await screenshot.listDisplays();

// 截取指定显示器
const img = await screenshot({ 
    format: 'jpg', 
    quality: 80, 
    screen: displays[0].id 
});

// sharp 使用
const sharp = require('sharp');

// 调整尺寸
const resized = await sharp(imgBuffer)
    .resize({ width: Math.round(originalWidth * 0.5) })
    .toBuffer();
```
