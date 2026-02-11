/**
 * Electron 预加载脚本
 * 通过 contextBridge 安全地向渲染进程暴露 IPC API
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // ========== 应用信息 ==========

    /** 获取应用版本号 */
    getVersion: () => ipcRenderer.invoke('app:version'),

    // ========== 服务控制 ==========

    /** 启动服务 */
    startService: (serviceName) => ipcRenderer.invoke('service:start', serviceName),

    /** 停止服务 */
    stopService: (serviceName) => ipcRenderer.invoke('service:stop', serviceName),

    /** 一键启动所有服务（截图+AI总结） */
    startAllServices: () => ipcRenderer.invoke('service:start-all'),

    /** 一键停止所有服务 */
    stopAllServices: () => ipcRenderer.invoke('service:stop-all'),

    /** 获取所有服务状态 */
    getStatus: () => ipcRenderer.invoke('service:status'),

    /** 获取服务日志 */
    getLogs: (serviceName, count) => ipcRenderer.invoke('service:logs', serviceName, count),

    /** 清除服务日志 */
    clearLogs: (serviceName) => ipcRenderer.invoke('service:clear-logs', serviceName),

    // ========== 配置管理 ==========

    /** 加载配置 */
    loadConfig: () => ipcRenderer.invoke('config:load'),

    /** 保存配置 */
    saveConfig: (config) => ipcRenderer.invoke('config:save', config),

    /** 获取示例配置 */
    loadExampleConfig: () => ipcRenderer.invoke('config:load-example'),

    // ========== 数据读取 ==========

    /** 获取可用的总结日期 */
    getSummaryDates: () => ipcRenderer.invoke('summary:dates'),

    /** 获取指定日期和粒度的总结 */
    getSummaries: (date, granularity) => ipcRenderer.invoke('summary:get', date, granularity),

    /** 获取最近的截图列表 */
    getRecentScreenshots: (count) => ipcRenderer.invoke('screenshot:recent', count),

    /** 读取截图文件为 base64 */
    readScreenshot: (filepath) => ipcRenderer.invoke('screenshot:read', filepath),

    /** 清理过期截图 */
    cleanupScreenshots: () => ipcRenderer.invoke('screenshot:cleanup'),

    // ========== Token 统计 ==========

    /** 获取可用的 token 统计日期 */
    getTokenStatsDates: () => ipcRenderer.invoke('token-stats:dates'),

    /** 查询 token 统计数据 */
    getTokenStats: (date, options) => ipcRenderer.invoke('token-stats:query', date, options),

    // ========== Todo List ==========

    /** 获取所有任务 */
    getTodos: () => ipcRenderer.invoke('todo:list'),

    /** 创建主任务 */
    createTodo: (params) => ipcRenderer.invoke('todo:create', params),

    /** 更新主任务 */
    updateTodo: (todoId, updates) => ipcRenderer.invoke('todo:update', todoId, updates),

    /** 删除主任务 */
    deleteTodo: (todoId) => ipcRenderer.invoke('todo:delete', todoId),

    /** 创建子任务 */
    createSubtask: (parentId, params) => ipcRenderer.invoke('todo:create-subtask', parentId, params),

    /** 更新子任务 */
    updateSubtask: (parentId, subtaskId, updates) => ipcRenderer.invoke('todo:update-subtask', parentId, subtaskId, updates),

    /** 删除子任务 */
    deleteSubtask: (parentId, subtaskId) => ipcRenderer.invoke('todo:delete-subtask', parentId, subtaskId),

    // ========== 行为目录 ==========

    /** 获取所有行为 */
    getBehaviors: () => ipcRenderer.invoke('behavior:list'),

    /** 创建行为 */
    createBehavior: (params) => ipcRenderer.invoke('behavior:create', params),

    /** 更新行为 */
    updateBehavior: (behaviorId, updates) => ipcRenderer.invoke('behavior:update', behaviorId, updates),

    /** 删除行为 */
    deleteBehavior: (behaviorId) => ipcRenderer.invoke('behavior:delete', behaviorId),

    // ========== 重命名操作 ==========

    /** 重命名任务标题（历史数据自动回写） */
    renameTodo: (todoId, newTitle) => ipcRenderer.invoke('todo:rename', todoId, newTitle),

    /** 重命名行为名称（历史数据自动回写） */
    renameBehavior: (behaviorId, newName) => ipcRenderer.invoke('behavior:rename', behaviorId, newName),

    // ========== 合并操作 ==========

    /** 合并任务/行为（source 合并到 target，source 消失，历史数据回写） */
    mergeTodoItem: (params) => ipcRenderer.invoke('todo:merge', params),

    // ========== 事件监听 ==========

    /** 监听日志更新 */
    onLog: (callback) => {
        const listener = (_event, serviceName, entry) => callback(serviceName, entry);
        ipcRenderer.on('log-update', listener);
        return () => ipcRenderer.removeListener('log-update', listener);
    },

    /** 监听服务状态变更 */
    onServiceChange: (callback) => {
        const listener = (_event, type, serviceName) => callback(type, serviceName);
        ipcRenderer.on('service-change', listener);
        return () => ipcRenderer.removeListener('service-change', listener);
    }
});
