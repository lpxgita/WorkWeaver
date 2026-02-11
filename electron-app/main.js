/**
 * Work Monitor - Electron 主进程
 * 负责窗口管理、IPC 通信、服务进程编排
 */

const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const ServiceManager = require('./service-manager');
const ConfigManager = require('./config-manager');
const SummaryReader = require('./summary-reader');
const TodoStore = require('./todo-store');

// 项目根目录（子模块脚本所在位置）
// 开发时：上级目录 work_monitor/
// 打包后：Resources/ 目录（子模块通过 extraResources 复制到此处）
let projectRoot;
if (app.isPackaged) {
    projectRoot = path.join(process.resourcesPath);
} else {
    projectRoot = path.resolve(__dirname, '..');
}

/**
 * 获取用户配置文件路径
 * 打包后配置文件存放在 userData 目录（可读写），避免写入 .app 内部
 * 首次运行时从 Resources/ 复制默认配置
 * 开发环境直接使用项目根目录的 config.yaml
 * @returns {string} config.yaml 的绝对路径
 */
function getUserConfigPath() {
    if (!app.isPackaged) {
        return path.join(projectRoot, 'config.yaml');
    }

    const userDataDir = app.getPath('userData');
    const userConfigPath = path.join(userDataDir, 'config.yaml');

    // 首次运行：从 Resources/ 复制默认配置到 userData
    if (!fs.existsSync(userConfigPath)) {
        const bundledConfigPath = path.join(process.resourcesPath, 'config.yaml');
        if (fs.existsSync(bundledConfigPath)) {
            fs.mkdirSync(userDataDir, { recursive: true });
            fs.copyFileSync(bundledConfigPath, userConfigPath);
        }
    }

    return userConfigPath;
}

// 初始化管理器
// ServiceManager 指向 projectRoot（子模块脚本位置）
// ConfigManager 指向用户可写的配置文件
const configPath = getUserConfigPath();
// Todo 数据目录：开发环境在项目根 data/todo，打包后在 userData/todo
const todoDataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'todo')
    : path.join(projectRoot, 'data', 'todo');
const todoStore = new TodoStore(todoDataDir);
const serviceManager = new ServiceManager(projectRoot, configPath, { todoDataDir });
const configManager = new ConfigManager(configPath);
const summaryReader = new SummaryReader(projectRoot);

let mainWindow = null;

/**
 * 创建主窗口
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Work Monitor',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a2e' : '#f8f9fa',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        }
    });

    mainWindow.loadFile('renderer/index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ========== IPC 处理：应用信息 ==========

ipcMain.handle('app:version', () => {
    return app.getVersion();
});

// ========== IPC 处理：服务控制 ==========

ipcMain.handle('service:start', async (_event, serviceName) => {
    try {
        const result = serviceManager.startService(serviceName);
        return { success: result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('service:stop', async (_event, serviceName) => {
    try {
        const result = await serviceManager.stopService(serviceName);
        return { success: result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('service:start-all', async () => {
    try {
        const result = serviceManager.startAll();
        return { success: true, data: result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('service:stop-all', async () => {
    try {
        await serviceManager.stopAll();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('service:status', async () => {
    return serviceManager.getAllStatus();
});

ipcMain.handle('service:logs', async (_event, serviceName, count) => {
    return serviceManager.getLogs(serviceName, count);
});

ipcMain.handle('service:clear-logs', async (_event, serviceName) => {
    serviceManager.clearLogs(serviceName);
    return { success: true };
});

// ========== IPC 处理：配置管理 ==========

ipcMain.handle('config:load', async () => {
    try {
        const config = configManager.load();
        return { success: true, data: config };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('config:save', async (_event, config) => {
    try {
        configManager.save(config);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('config:load-example', async () => {
    try {
        const content = configManager.loadExample();
        return { success: true, data: content };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ========== IPC 处理：数据读取 ==========

ipcMain.handle('summary:dates', async () => {
    try {
        const config = configManager.load();
        const dates = summaryReader.getAvailableDates(config);
        return { success: true, data: dates };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('summary:get', async (_event, date, granularity) => {
    try {
        const config = configManager.load();
        const summaries = summaryReader.getSummaries(config, date, granularity);
        return { success: true, data: summaries };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ========== IPC 处理：Token 统计 ==========

ipcMain.handle('token-stats:dates', async () => {
    try {
        const config = configManager.load();
        const dates = summaryReader.getTokenStatsDates(config);
        return { success: true, data: dates };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('token-stats:query', async (_event, date, options) => {
    try {
        const config = configManager.load();
        const stats = summaryReader.getTokenStats(config, date, options || {});
        return { success: true, data: stats };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('screenshot:cleanup', async () => {
    try {
        const config = configManager.load();
        // 解析截图存储目录
        const storageDir = config.storage?.directory || './screenshots';
        const baseDir = storageDir.startsWith('~')
            ? path.join(require('os').homedir(), storageDir.slice(1))
            : (path.isAbsolute(storageDir) ? storageDir : path.join(projectRoot, storageDir));

        // 使用 auto_screenshot 的清理模块
        const cleanerPath = path.join(projectRoot, 'auto_screenshot', 'src', 'cleaner.js');
        const ScreenshotCleaner = require(cleanerPath);
        // 简易日志适配器
        const logger = {
            info: (msg) => console.log(`[cleanup] ${msg}`),
            warn: (msg) => console.warn(`[cleanup] ${msg}`),
            error: (msg) => console.error(`[cleanup] ${msg}`)
        };
        const cleaner = new ScreenshotCleaner(baseDir, logger, config.storage?.cleanup || {});
        const stats = await cleaner.clean();
        return { success: true, data: stats };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('screenshot:recent', async (_event, count) => {
    try {
        const config = configManager.load();
        const screenshots = summaryReader.getRecentScreenshots(config, count);
        return { success: true, data: screenshots };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('screenshot:read', async (_event, filepath) => {
    try {
        if (!fs.existsSync(filepath)) {
            return { success: false, error: '文件不存在' };
        }
        const buffer = fs.readFileSync(filepath);
        const ext = path.extname(filepath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
        const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
        return { success: true, data: base64 };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ========== IPC 处理：Todo List ==========

ipcMain.handle('todo:list', async () => {
    try {
        const todos = todoStore.getAllTodos();
        return { success: true, data: todos };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('todo:create', async (_event, params) => {
    try {
        const todo = todoStore.createTodo(params);
        return { success: true, data: todo };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('todo:update', async (_event, todoId, updates) => {
    try {
        const todo = todoStore.updateTodo(todoId, updates);
        if (!todo) return { success: false, error: '任务不存在' };
        return { success: true, data: todo };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('todo:delete', async (_event, todoId) => {
    try {
        const result = todoStore.deleteTodo(todoId);
        if (!result) return { success: false, error: '任务不存在' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('todo:create-subtask', async (_event, parentId, params) => {
    try {
        const subtask = todoStore.createSubtask(parentId, params);
        if (!subtask) return { success: false, error: '父任务不存在' };
        return { success: true, data: subtask };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('todo:update-subtask', async (_event, parentId, subtaskId, updates) => {
    try {
        const subtask = todoStore.updateSubtask(parentId, subtaskId, updates);
        if (!subtask) return { success: false, error: '任务或子任务不存在' };
        return { success: true, data: subtask };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('todo:delete-subtask', async (_event, parentId, subtaskId) => {
    try {
        const result = todoStore.deleteSubtask(parentId, subtaskId);
        if (!result) return { success: false, error: '任务或子任务不存在' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ========== IPC 处理：行为目录 ==========

ipcMain.handle('behavior:list', async () => {
    try {
        const behaviors = todoStore.getAllBehaviors();
        return { success: true, data: behaviors };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('behavior:create', async (_event, params) => {
    try {
        const behavior = todoStore.createBehavior(params);
        return { success: true, data: behavior };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('behavior:update', async (_event, behaviorId, updates) => {
    try {
        const behavior = todoStore.updateBehavior(behaviorId, updates);
        if (!behavior) return { success: false, error: '行为不存在' };
        return { success: true, data: behavior };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('behavior:delete', async (_event, behaviorId) => {
    try {
        const result = todoStore.deleteBehavior(behaviorId);
        if (!result) return { success: false, error: '行为不存在' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ========== IPC 处理：重命名操作（含历史数据回写） ==========

ipcMain.handle('todo:rename', async (_event, todoId, newTitle) => {
    try {
        const result = todoStore.renameTodo(todoId, newTitle);
        if (!result.success) {
            return { success: false, error: result.error };
        }
        // 标题变更时回写历史总结
        if (result.changed) {
            const config = configManager.load();
            const summaryDir = _resolveSummaryDir(config);
            if (fs.existsSync(summaryDir)) {
                _rewriteHistoryLabels(summaryDir, result.oldTitle, result.newTitle);
            }
        }
        return { success: true, oldTitle: result.oldTitle, newTitle: result.newTitle };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('behavior:rename', async (_event, behaviorId, newName) => {
    try {
        const result = todoStore.renameBehavior(behaviorId, newName);
        if (!result.success) {
            return { success: false, error: result.error };
        }
        // 名称变更时回写历史总结
        if (result.changed) {
            const config = configManager.load();
            const summaryDir = _resolveSummaryDir(config);
            if (fs.existsSync(summaryDir)) {
                _rewriteHistoryLabels(summaryDir, result.oldName, result.newName);
            }
        }
        return { success: true, oldName: result.oldName, newName: result.newName };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ========== IPC 处理：合并操作（含历史数据回写） ==========

ipcMain.handle('todo:merge', async (_event, params) => {
    try {
        // 1. 执行合并（获取源名称和目标名称，并删除源）
        const mergeResult = todoStore.merge(params);
        if (!mergeResult.success) {
            return { success: false, error: mergeResult.error };
        }

        // 2. 回溯修改历史总结数据中的 label
        const { sourceName, targetName } = mergeResult;
        const config = configManager.load();
        const summaryDir = _resolveSummaryDir(config);

        if (fs.existsSync(summaryDir)) {
            _rewriteHistoryLabels(summaryDir, sourceName, targetName);
        }

        return { success: true, sourceName, targetName };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * 解析总结目录路径
 * @param {Object} config - 配置对象
 * @returns {string} 绝对路径
 */
function _resolveSummaryDir(config) {
    const dir = config.summary?.directory || './summaries';
    if (dir === '~') {
        return require('os').homedir();
    }
    if (dir.startsWith('~/') || dir.startsWith('~\\')) {
        return path.join(require('os').homedir(), dir.slice(2));
    }
    if (path.isAbsolute(dir)) return dir;
    return path.resolve(projectRoot, 'ai_summary', dir);
}

/**
 * 回溯修改历史总结数据中的 label
 * 遍历所有日期目录和粒度目录下的 JSON 文件，将 sourceName 替换为 targetName
 * @param {string} summaryDir - 总结根目录
 * @param {string} sourceName - 源名称（被合并的）
 * @param {string} targetName - 目标名称（合并到的）
 */
function _rewriteHistoryLabels(summaryDir, sourceName, targetName) {
    try {
        // 遍历日期目录
        const dateDirs = fs.readdirSync(summaryDir).filter(d => {
            const fullPath = path.join(summaryDir, d);
            return fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
        });

        let rewriteCount = 0;
        for (const dateDir of dateDirs) {
            const datePath = path.join(summaryDir, dateDir);
            // 遍历粒度目录
            const granDirs = fs.readdirSync(datePath).filter(g => {
                return fs.statSync(path.join(datePath, g)).isDirectory();
            });

            for (const granDir of granDirs) {
                const granPath = path.join(datePath, granDir);
                const jsonFiles = fs.readdirSync(granPath).filter(f => f.endsWith('.json'));

                for (const jsonFile of jsonFiles) {
                    const filePath = path.join(granPath, jsonFile);
                    try {
                        const raw = fs.readFileSync(filePath, 'utf-8');
                        const original = raw;

                        // 使用字符串替换所有匹配的 sourceName → targetName
                        // 这会覆盖 category_name、label、task_label 等所有出现位置
                        const updated = raw.split(JSON.stringify(sourceName)).join(JSON.stringify(targetName));

                        if (updated !== original) {
                            fs.writeFileSync(filePath, updated, 'utf-8');
                            rewriteCount++;
                        }
                    } catch (fileErr) {
                        // 单个文件失败不中断
                        console.warn(`回写文件失败: ${filePath} - ${fileErr.message}`);
                    }
                }
            }
        }

        if (rewriteCount > 0) {
            console.log(`[合并回写] 已更新 ${rewriteCount} 个历史总结文件: "${sourceName}" → "${targetName}"`);
        }
    } catch (err) {
        console.error(`[合并回写] 遍历总结目录失败: ${err.message}`);
    }
}

// ========== 服务事件转发到渲染进程 ==========

serviceManager.on('log', (serviceName, entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log-update', serviceName, entry);
    }
});

serviceManager.on('service-started', (serviceName) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('service-change', 'started', serviceName);
    }
});

serviceManager.on('service-stopped', (serviceName) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('service-change', 'stopped', serviceName);
    }
});

// ========== 应用生命周期 ==========

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', async () => {
    // 停止所有服务
    await serviceManager.stopAll();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async () => {
    await serviceManager.stopAll();
});
