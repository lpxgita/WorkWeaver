/**
 * Todo 回写模块
 * 解析 AI 总结响应中的分类信息，将新任务/子任务/行为写入 JSON 文件
 * 仅在 2min 粒度执行回写（最细粒度，避免重复）
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TodoWriter {
    /**
     * @param {string} todoDataDir - Todo 数据目录（含 todos.json / behaviors.json）
     * @param {Logger} logger - 日志模块
     */
    constructor(todoDataDir, logger) {
        this.todoDataDir = todoDataDir;
        this.todosFile = path.join(todoDataDir, 'todos.json');
        this.behaviorsFile = path.join(todoDataDir, 'behaviors.json');
        this.logger = logger;
    }

    /**
     * 读取 JSON 文件
     * @param {string} filePath - 文件路径
     * @param {*} defaultValue - 默认值
     * @returns {*}
     */
    _readJSON(filePath, defaultValue = []) {
        try {
            if (!fs.existsSync(filePath)) return defaultValue;
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (err) {
            this.logger.warn(`读取文件失败: ${filePath} - ${err.message}`);
            return defaultValue;
        }
    }

    /**
     * 写入 JSON 文件
     * @param {string} filePath - 文件路径
     * @param {*} data - 数据
     */
    _writeJSON(filePath, data) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    /**
     * 根据 2min AI 总结响应，回写新任务/子任务/行为
     * 支持新的列表格式（category_type/category_name/subtask_name 均为数组）和旧的字符串格式
     * 仅处理 category_type 为"新建任务"/"新建行为"，或已有任务下的新子任务
     * @param {Object} parsed - 解析后的 AI 响应
     */
    processResponse(parsed) {
        if (!parsed) {
            return;
        }

        try {
            // 兼容新格式（列表）和旧格式（字符串）
            const types = this._normalizeToArray(parsed.category_type);
            const names = this._normalizeToArray(parsed.category_name);
            const subtasks = this._normalizeToArray(parsed.subtask_name);

            if (types.length === 0 || names.length === 0) {
                return;
            }

            // 逐项处理
            const count = Math.min(types.length, names.length);
            for (let i = 0; i < count; i++) {
                const categoryType = types[i];
                const categoryName = names[i];
                const subtaskName = i < subtasks.length ? subtasks[i] : '';

                if (!categoryType || !categoryName) continue;

                if (categoryType === '新建任务') {
                    this._ensureTask(categoryName, subtaskName);
                } else if (categoryType === '新建行为') {
                    this._ensureBehavior(categoryName);
                } else if (categoryType === '任务' && subtaskName) {
                    // 已有任务下可能需要添加新子任务
                    this._ensureSubtask(categoryName, subtaskName);
                }
            }
        } catch (err) {
            this.logger.warn(`Todo 回写失败（不影响主流程）: ${err.message}`);
        }
    }

    /**
     * 将值标准化为字符串数组（兼容字符串和数组输入）
     * @param {*} value - 输入值
     * @returns {string[]} 去空格后的字符串数组
     */
    _normalizeToArray(value) {
        if (Array.isArray(value)) {
            return value
                .map(v => (typeof v === 'string' ? v.trim() : ''))
                .filter(v => v !== '');
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed ? [trimmed] : [];
        }
        return [];
    }

    /**
     * 确保任务存在，不存在则创建
     * @param {string} taskName - 主任务名
     * @param {string} [subtaskName] - 可选的子任务名
     */
    _ensureTask(taskName, subtaskName) {
        if (!taskName) return;
        const todos = this._readJSON(this.todosFile, []);
        let task = todos.find(t => t.title === taskName);

        if (!task) {
            task = {
                id: uuidv4(),
                title: taskName,
                description: '',
                type: 'normal',
                completed: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'ai',     // 标记为 AI 自动创建
                children: []
            };
            todos.push(task);
            this.logger.info(`[Todo回写] 创建新任务: ${taskName}`);
        }

        if (subtaskName && !task.children.find(c => c.title === subtaskName)) {
            task.children.push({
                id: uuidv4(),
                title: subtaskName,
                completed: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'ai'
            });
            task.updatedAt = new Date().toISOString();
            this.logger.info(`[Todo回写] 在任务"${taskName}"下创建子任务: ${subtaskName}`);
        }

        this._writeJSON(this.todosFile, todos);
    }

    /**
     * 确保行为存在，不存在则创建
     * @param {string} behaviorName - 行为名
     */
    _ensureBehavior(behaviorName) {
        if (!behaviorName) return;
        const behaviors = this._readJSON(this.behaviorsFile, []);
        if (behaviors.find(b => b.name === behaviorName)) {
            return; // 已存在
        }

        behaviors.push({
            id: uuidv4(),
            name: behaviorName,
            description: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'ai'     // 标记为 AI 自动创建
        });
        this._writeJSON(this.behaviorsFile, behaviors);
        this.logger.info(`[Todo回写] 创建新行为: ${behaviorName}`);
    }

    /**
     * 确保已有任务下的子任务存在
     * @param {string} taskName - 主任务名
     * @param {string} subtaskName - 子任务名
     */
    _ensureSubtask(taskName, subtaskName) {
        if (!taskName || !subtaskName) return;
        const todos = this._readJSON(this.todosFile, []);
        const task = todos.find(t => t.title === taskName);
        if (!task) return; // 主任务不存在，不处理

        if (task.children.find(c => c.title === subtaskName)) {
            return; // 子任务已存在
        }

        task.children.push({
            id: uuidv4(),
            title: subtaskName,
            completed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'ai'
        });
        task.updatedAt = new Date().toISOString();
        this._writeJSON(this.todosFile, todos);
        this.logger.info(`[Todo回写] 在任务"${taskName}"下创建子任务: ${subtaskName}`);
    }
}

module.exports = TodoWriter;
