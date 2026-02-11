/**
 * 服务管理模块
 * 封装 auto_screenshot 和 ai_summary 子进程的启动/停止/状态管理
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

class ServiceManager extends EventEmitter {
    /**
     * 创建服务管理器
     * @param {string} projectRoot - 项目根目录路径（子模块脚本所在位置）
     * @param {string} [configPath] - 配置文件路径（可选，默认为 projectRoot/config.yaml）
     * @param {Object} [options] - 额外选项
     * @param {string} [options.todoDataDir] - Todo 数据目录，传给 ai_summary
     */
    constructor(projectRoot, configPath, options = {}) {
        super();
        this.projectRoot = projectRoot;
        this.configPath = configPath || path.join(projectRoot, 'config.yaml');
        this.todoDataDir = options.todoDataDir || '';

        // 服务进程引用
        this.processes = {
            screenshot: null,
            summary: null
        };

        // 服务状态
        this.status = {
            screenshot: { running: false, pid: null, startTime: null, logs: [] },
            summary: { running: false, pid: null, startTime: null, logs: [] }
        };

        // 日志缓冲区最大行数
        this.maxLogLines = 500;
    }

    /**
     * 获取配置文件路径
     * @returns {string} config.yaml 路径
     */
    getConfigPath() {
        return this.configPath;
    }

    /**
     * 获取服务脚本路径
     * @param {string} serviceName - 'screenshot' | 'summary'
     * @returns {string} main.js 路径
     */
    _getScriptPath(serviceName) {
        const dirMap = {
            screenshot: 'auto_screenshot',
            summary: 'ai_summary'
        };
        return path.join(this.projectRoot, dirMap[serviceName], 'main.js');
    }

    /**
     * 获取 Node.js 可执行文件路径
     * 打包环境下使用 Electron 内置 Node，开发环境直接使用 process.execPath
     * @returns {string}
     */
    _getNodePath() {
        // 在 Electron 打包环境中，设置 ELECTRON_RUN_AS_NODE=1 让 Electron 作为 Node 运行
        return process.execPath;
    }

    /**
     * 启动指定服务
     * @param {string} serviceName - 'screenshot' | 'summary'
     * @returns {boolean} 是否成功启动
     */
    startService(serviceName) {
        if (this.processes[serviceName]) {
            this._addLog(serviceName, 'warn', '服务已在运行中');
            return false;
        }

        const scriptPath = this._getScriptPath(serviceName);
        const configPath = this.getConfigPath();

        // 检查脚本是否存在
        if (!fs.existsSync(scriptPath)) {
            this._addLog(serviceName, 'error', `服务脚本不存在: ${scriptPath}`);
            return false;
        }

        try {
            // 查找 node 可执行文件路径
            const nodePath = this._getNodePath();
            this._addLog(serviceName, 'info', `使用 Node: ${nodePath}`);

            // 构建启动参数
            const spawnArgs = [scriptPath, '--config', configPath];
            // 对 ai_summary 服务传入 todo 数据目录
            if (serviceName === 'summary' && this.todoDataDir) {
                spawnArgs.push('--todo-dir', this.todoDataDir);
            }

            // 使用 spawn 创建子进程（兼容 Electron 打包环境）
            const child = spawn(nodePath, spawnArgs, {
                cwd: path.dirname(scriptPath),
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
            });

            this.processes[serviceName] = child;
            this.status[serviceName] = {
                running: true,
                pid: child.pid,
                startTime: new Date().toISOString(),
                logs: this.status[serviceName].logs // 保留已有日志
            };

            this._addLog(serviceName, 'info', `服务启动成功 (PID: ${child.pid})`);

            // 监听 stdout
            child.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        this._addLog(serviceName, 'stdout', line.trim());
                    }
                }
            });

            // 监听 stderr
            child.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        this._addLog(serviceName, 'stderr', line.trim());
                    }
                }
            });

            // 监听退出
            child.on('exit', (code, signal) => {
                const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
                this._addLog(serviceName, 'info', `服务已退出 (${reason})`);
                this.processes[serviceName] = null;
                this.status[serviceName].running = false;
                this.status[serviceName].pid = null;
                this.emit('service-stopped', serviceName, code, signal);
            });

            // 监听错误
            child.on('error', (err) => {
                this._addLog(serviceName, 'error', `进程错误: ${err.message}`);
                this.processes[serviceName] = null;
                this.status[serviceName].running = false;
                this.status[serviceName].pid = null;
                this.emit('service-error', serviceName, err);
            });

            this.emit('service-started', serviceName);
            return true;

        } catch (err) {
            this._addLog(serviceName, 'error', `启动失败: ${err.message}`);
            return false;
        }
    }

    /**
     * 停止指定服务
     * @param {string} serviceName - 'screenshot' | 'summary'
     * @returns {Promise<boolean>} 是否成功停止
     */
    async stopService(serviceName) {
        const child = this.processes[serviceName];
        if (!child) {
            this._addLog(serviceName, 'warn', '服务未在运行');
            return false;
        }

        this._addLog(serviceName, 'info', '正在停止服务...');

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                // 超时强制杀死
                this._addLog(serviceName, 'warn', '服务停止超时，强制终止');
                child.kill('SIGKILL');
            }, 10000);

            child.on('exit', () => {
                clearTimeout(timeout);
                resolve(true);
            });

            // 发送 SIGTERM 信号实现优雅关闭
            child.kill('SIGTERM');
        });
    }

    /**
     * 停止所有服务
     * @returns {Promise<void>}
     */
    async stopAll() {
        const promises = [];
        if (this.processes.screenshot) {
            promises.push(this.stopService('screenshot'));
        }
        if (this.processes.summary) {
            promises.push(this.stopService('summary'));
        }
        await Promise.all(promises);
    }

    /**
     * 一键启动所有服务（截图+AI总结）
     * 如果某个服务已在运行，则跳过
     * @returns {{ screenshot: boolean, summary: boolean }} 各服务启动结果
     */
    startAll() {
        const result = { screenshot: false, summary: false };
        if (!this.processes.screenshot) {
            result.screenshot = this.startService('screenshot');
        } else {
            this._addLog('screenshot', 'info', '服务已在运行中，跳过启动');
            result.screenshot = true;
        }
        if (!this.processes.summary) {
            result.summary = this.startService('summary');
        } else {
            this._addLog('summary', 'info', '服务已在运行中，跳过启动');
            result.summary = true;
        }
        return result;
    }

    /**
     * 判断是否所有服务都在运行
     * @returns {boolean}
     */
    isAllRunning() {
        return !!this.processes.screenshot && !!this.processes.summary;
    }

    /**
     * 获取服务状态（不含 logs，避免 IPC 传输大量日志数据）
     * @param {string} serviceName - 'screenshot' | 'summary'
     * @returns {Object} 服务状态（running, pid, startTime）
     */
    getServiceStatus(serviceName) {
        const { logs, ...statusWithoutLogs } = this.status[serviceName];
        return statusWithoutLogs;
    }

    /**
     * 获取所有服务状态
     * @returns {Object} 所有服务状态
     */
    getAllStatus() {
        return {
            screenshot: this.getServiceStatus('screenshot'),
            summary: this.getServiceStatus('summary')
        };
    }

    /**
     * 获取服务日志
     * @param {string} serviceName - 'screenshot' | 'summary'
     * @param {number} [count=100] - 返回最近的行数
     * @returns {Array} 日志列表
     */
    getLogs(serviceName, count = 100) {
        const logs = this.status[serviceName].logs;
        return logs.slice(-count);
    }

    /**
     * 清除服务日志
     * @param {string} serviceName - 'screenshot' | 'summary'
     */
    clearLogs(serviceName) {
        this.status[serviceName].logs = [];
    }

    /**
     * 添加日志
     * @param {string} serviceName - 服务名
     * @param {string} level - 日志级别
     * @param {string} message - 日志内容
     */
    _addLog(serviceName, level, message) {
        const entry = {
            time: new Date().toISOString(),
            level,
            message
        };

        this.status[serviceName].logs.push(entry);

        // 限制日志缓冲区大小
        if (this.status[serviceName].logs.length > this.maxLogLines) {
            this.status[serviceName].logs = this.status[serviceName].logs.slice(-this.maxLogLines);
        }

        // 发射日志事件
        this.emit('log', serviceName, entry);
    }
}

module.exports = ServiceManager;
