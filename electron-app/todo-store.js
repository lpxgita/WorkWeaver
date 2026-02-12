/**
 * Todo List 数据存储模块
 * 使用 JSON 文件持久化，支持主任务、子任务、描述、行为目录
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TodoStore {
    /**
     * @param {string} dataDir - 数据目录路径（存储 todo JSON 文件）
     */
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.todosFile = path.join(dataDir, 'todos.json');
        this.behaviorsFile = path.join(dataDir, 'behaviors.json');
        this._ensureDir();
    }

    // ========== 内部方法 ==========

    /**
     * 确保数据目录存在
     */
    _ensureDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    /**
     * 读取 JSON 文件
     * @param {string} filePath - 文件路径
     * @param {*} defaultValue - 文件不存在时的默认值
     * @returns {*} 解析后的数据
     */
    _readJSON(filePath, defaultValue = []) {
        try {
            if (!fs.existsSync(filePath)) {
                return defaultValue;
            }
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw);
        } catch (err) {
            console.error(`读取文件失败: ${filePath}`, err);
            return defaultValue;
        }
    }

    /**
     * 写入 JSON 文件
     * @param {string} filePath - 文件路径
     * @param {*} data - 要写入的数据
     */
    _writeJSON(filePath, data) {
        this._ensureDir();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    // ========== 任务 CRUD ==========

    /**
     * 获取所有主任务（含子任务）
     * @returns {Array} 任务列表
     */
    getAllTodos() {
        return this._readJSON(this.todosFile, []);
    }

    /**
     * 创建主任务
     * @param {Object} params - 任务参数
     * @param {string} params.title - 任务标题
     * @param {string} [params.description] - 任务描述
     * @returns {Object} 新创建的任务
     */
    createTodo({ title, description = '' }) {
        const todos = this.getAllTodos();
        const todo = {
            id: uuidv4(),
            title,
            description,
            type: 'normal',       // 默认普通任务
            completed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            children: []          // 子任务列表
        };
        todos.push(todo);
        this._writeJSON(this.todosFile, todos);
        return todo;
    }

    /**
     * 更新主任务
     * @param {string} todoId - 任务 ID
     * @param {Object} updates - 需要更新的字段（title, description, type, completed）
     * @returns {Object|null} 更新后的任务，不存在时返回 null
     */
    updateTodo(todoId, updates) {
        const todos = this.getAllTodos();
        const idx = todos.findIndex(t => t.id === todoId);
        if (idx === -1) return null;

        const allowedFields = ['title', 'description', 'type', 'completed'];
        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                todos[idx][key] = updates[key];
            }
        }
        todos[idx].updatedAt = new Date().toISOString();
        this._writeJSON(this.todosFile, todos);
        return todos[idx];
    }

    /**
     * 删除主任务（及其所有子任务）
     * @param {string} todoId - 任务 ID
     * @returns {boolean} 是否删除成功
     */
    deleteTodo(todoId) {
        const todos = this.getAllTodos();
        const idx = todos.findIndex(t => t.id === todoId);
        if (idx === -1) return false;

        todos.splice(idx, 1);
        this._writeJSON(this.todosFile, todos);
        return true;
    }

    // ========== 子任务 CRUD ==========

    /**
     * 创建子任务
     * @param {string} parentId - 父任务 ID
     * @param {Object} params - 子任务参数
     * @param {string} params.title - 子任务标题
     * @returns {Object|null} 新创建的子任务，父任务不存在时返回 null
     */
    createSubtask(parentId, { title }) {
        const todos = this.getAllTodos();
        const parent = todos.find(t => t.id === parentId);
        if (!parent) return null;

        const subtask = {
            id: uuidv4(),
            title,
            completed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        parent.children.push(subtask);
        parent.updatedAt = new Date().toISOString();
        this._writeJSON(this.todosFile, todos);
        return subtask;
    }

    /**
     * 更新子任务
     * @param {string} parentId - 父任务 ID
     * @param {string} subtaskId - 子任务 ID
     * @param {Object} updates - 需要更新的字段（title, completed）
     * @returns {Object|null} 更新后的子任务
     */
    updateSubtask(parentId, subtaskId, updates) {
        const todos = this.getAllTodos();
        const parent = todos.find(t => t.id === parentId);
        if (!parent) return null;

        const subtask = parent.children.find(c => c.id === subtaskId);
        if (!subtask) return null;

        const allowedFields = ['title', 'completed'];
        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                subtask[key] = updates[key];
            }
        }
        subtask.updatedAt = new Date().toISOString();
        parent.updatedAt = new Date().toISOString();
        this._writeJSON(this.todosFile, todos);
        return subtask;
    }

    /**
     * 删除子任务
     * @param {string} parentId - 父任务 ID
     * @param {string} subtaskId - 子任务 ID
     * @returns {boolean} 是否删除成功
     */
    deleteSubtask(parentId, subtaskId) {
        const todos = this.getAllTodos();
        const parent = todos.find(t => t.id === parentId);
        if (!parent) return false;

        const idx = parent.children.findIndex(c => c.id === subtaskId);
        if (idx === -1) return false;

        parent.children.splice(idx, 1);
        parent.updatedAt = new Date().toISOString();
        this._writeJSON(this.todosFile, todos);
        return true;
    }

    // ========== 行为目录 ==========

    /**
     * 获取所有行为
     * @returns {Array} 行为列表
     */
    getAllBehaviors() {
        return this._readJSON(this.behaviorsFile, []);
    }

    /**
     * 创建行为
     * @param {Object} params - 行为参数
     * @param {string} params.name - 行为名称（如"浏览网站"）
     * @param {string} [params.description] - 行为描述
     * @returns {Object} 新创建的行为
     */
    createBehavior({ name, description = '' }) {
        const behaviors = this.getAllBehaviors();
        const behavior = {
            id: uuidv4(),
            name,
            description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'user'       // 标记为用户主动创建
        };
        behaviors.push(behavior);
        this._writeJSON(this.behaviorsFile, behaviors);
        return behavior;
    }

    /**
     * 更新行为
     * @param {string} behaviorId - 行为 ID
     * @param {Object} updates - 需要更新的字段（name, description）
     * @returns {Object|null} 更新后的行为
     */
    updateBehavior(behaviorId, updates) {
        const behaviors = this.getAllBehaviors();
        const idx = behaviors.findIndex(b => b.id === behaviorId);
        if (idx === -1) return null;

        const allowedFields = ['name', 'description'];
        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                behaviors[idx][key] = updates[key];
            }
        }
        behaviors[idx].updatedAt = new Date().toISOString();
        this._writeJSON(this.behaviorsFile, behaviors);
        return behaviors[idx];
    }

    /**
     * 删除行为
     * @param {string} behaviorId - 行为 ID
     * @returns {boolean} 是否删除成功
     */
    deleteBehavior(behaviorId) {
        const behaviors = this.getAllBehaviors();
        const idx = behaviors.findIndex(b => b.id === behaviorId);
        if (idx === -1) return false;

        behaviors.splice(idx, 1);
        this._writeJSON(this.behaviorsFile, behaviors);
        return true;
    }

    // ========== 重命名操作 ==========

    /**
     * 重命名任务标题
     * @param {string} todoId - 任务 ID
     * @param {string} newTitle - 新标题
     * @returns {Object} { success, oldTitle, newTitle } 或 { success: false, error }
     */
    renameTodo(todoId, newTitle) {
        if (!newTitle || typeof newTitle !== 'string' || !newTitle.trim()) {
            return { success: false, error: '新标题不能为空' };
        }
        newTitle = newTitle.trim();

        const todos = this.getAllTodos();
        const todo = todos.find(t => t.id === todoId);
        if (!todo) return { success: false, error: '任务不存在' };

        const oldTitle = todo.title;
        if (oldTitle === newTitle) {
            return { success: true, oldTitle, newTitle, changed: false };
        }

        todo.title = newTitle;
        todo.updatedAt = new Date().toISOString();
        this._writeJSON(this.todosFile, todos);

        return { success: true, oldTitle, newTitle, changed: true };
    }

    /**
     * 重命名行为名称
     * @param {string} behaviorId - 行为 ID
     * @param {string} newName - 新名称
     * @returns {Object} { success, oldName, newName } 或 { success: false, error }
     */
    renameBehavior(behaviorId, newName) {
        if (!newName || typeof newName !== 'string' || !newName.trim()) {
            return { success: false, error: '新名称不能为空' };
        }
        newName = newName.trim();

        const behaviors = this.getAllBehaviors();
        const behavior = behaviors.find(b => b.id === behaviorId);
        if (!behavior) return { success: false, error: '行为不存在' };

        const oldName = behavior.name;
        if (oldName === newName) {
            return { success: true, oldName, newName, changed: false };
        }

        behavior.name = newName;
        behavior.updatedAt = new Date().toISOString();
        this._writeJSON(this.behaviorsFile, behaviors);

        return { success: true, oldName, newName, changed: true };
    }

    // ========== 合并操作 ==========

    /**
     * 合并：将 source 合并到 target 中，source 消失，其时间归类到 target
     * 支持任务→任务、行为→行为、任务→行为、行为→任务
     * @param {Object} params
     * @param {string} params.sourceType - 'todo' 或 'behavior'
     * @param {string} params.sourceId - 源 ID
     * @param {string} params.targetType - 'todo' 或 'behavior'
     * @param {string} params.targetId - 目标 ID
     * @returns {Object} { success, sourceName, targetName } 合并信息（供历史数据回写使用）
     */
    merge({ sourceType, sourceId, targetType, targetId }) {
        const validTypes = ['todo', 'behavior'];
        if (!validTypes.includes(sourceType) || !validTypes.includes(targetType)) {
            return { success: false, error: '合并类型无效' };
        }
        if (sourceType === targetType && sourceId === targetId) {
            return { success: false, error: '不能将项目合并到自身' };
        }

        // 读取源名称
        let sourceName = '';
        if (sourceType === 'todo') {
            const todos = this.getAllTodos();
            const source = todos.find(t => t.id === sourceId);
            if (!source) return { success: false, error: '源任务不存在' };
            sourceName = source.title;
        } else {
            const behaviors = this.getAllBehaviors();
            const source = behaviors.find(b => b.id === sourceId);
            if (!source) return { success: false, error: '源行为不存在' };
            sourceName = source.name;
        }

        // 读取目标名称
        let targetName = '';
        if (targetType === 'todo') {
            const todos = this.getAllTodos();
            const target = todos.find(t => t.id === targetId);
            if (!target) return { success: false, error: '目标任务不存在' };
            targetName = target.title;
        } else {
            const behaviors = this.getAllBehaviors();
            const target = behaviors.find(b => b.id === targetId);
            if (!target) return { success: false, error: '目标行为不存在' };
            targetName = target.name;
        }

        // 删除源
        let removed = false;
        if (sourceType === 'todo') {
            removed = this.deleteTodo(sourceId);
        } else {
            removed = this.deleteBehavior(sourceId);
        }
        if (!removed) {
            return { success: false, error: '源项目删除失败' };
        }

        return { success: true, sourceName, targetName };
    }
}

module.exports = TodoStore;
