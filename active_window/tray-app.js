'use strict';

const { app, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const ActiveWindowMonitor = require('./src/active-window-monitor');

/**
 * 焦点窗口状态栏工具 - Electron Tray 应用
 * 
 * 在 macOS 顶部状态栏实时显示当前焦点窗口名称。
 * 使用 Electron Tray.setTitle() macOS 专属 API 在图标旁直接显示文本。
 * 
 * 功能:
 * - 状态栏实时显示: [应用名] 窗口标题
 * - 右键菜单: 切换显示模式、调整轮询间隔、暂停/恢复、查看历史、退出
 * - 支持多种显示模式: 完整模式 / 仅应用名 / 仅标题
 * - 无 Dock 图标，纯状态栏工具
 */

// ===== 全局状态 =====
let tray = null;
let monitor = null;

// 配置
const config = {
    interval: 1000,           // 轮询间隔(ms)
    maxTitleLength: 60,       // 状态栏显示的最大字符数
    displayMode: 'full',      // 显示模式: 'full' | 'app' | 'title'
    showIcon: true,           // 是否在文本前显示应用标识
};

// 运行状态
const state = {
    paused: false,
    currentWindow: null,
};

// ===== 图标创建 =====

/**
 * 创建 Tray 图标
 * 使用内联 1x1 像素透明 PNG 作为最小图标，
 * 因为主要依赖 setTitle 显示文本信息
 * @returns {NativeImage} Electron 原生图片对象
 */
function createTrayIcon() {
    // 尝试加载 assets 目录下的自定义图标
    const iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');
    try {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
            icon.setTemplateImage(true);
            return icon;
        }
    } catch (e) {
        // 自定义图标不存在，使用内置最小图标
    }

    // 生成一个 16x16 的极简窗口图标（黑色像素组成的小窗口形状）
    // 这是一个合法的 PNG 数据 URL
    const icon = nativeImage.createEmpty();
    // 退回到使用一个极小的透明占位图标
    // macOS 状态栏主要通过 setTitle 显示文本
    return nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4jWNgGAWDEwAAAhAAAbkMiKQAAAAASUVORK5CYII='
    );
}

// ===== 文本格式化 =====

/**
 * 格式化状态栏显示文本
 * @param {Object} windowInfo - 窗口信息 {app, title}
 * @returns {string} 格式化后的状态栏文本
 */
function formatTrayTitle(windowInfo) {
    if (!windowInfo) {
        return '  无焦点窗口';
    }

    const { app: appName, title } = windowInfo;
    let text = '';

    switch (config.displayMode) {
        case 'app':
            text = appName || '未知应用';
            break;
        case 'title':
            text = title || '(无标题)';
            break;
        case 'full':
        default:
            if (title) {
                text = `${appName} — ${title}`;
            } else {
                text = appName || '未知应用';
            }
            break;
    }

    // 截断过长文本
    if (text.length > config.maxTitleLength) {
        text = text.substring(0, config.maxTitleLength - 1) + '…';
    }

    // 前面加空格，让文本和图标之间有间距
    return `  ${text}`;
}

/**
 * 格式化时间
 * @param {number} timestamp - 毫秒时间戳
 * @returns {string} HH:MM:SS
 */
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// ===== 右键菜单 =====

/**
 * 构建右键上下文菜单
 * @returns {Menu} Electron 菜单对象
 */
function buildContextMenu() {
    const history = monitor ? monitor.getHistory() : [];
    const status = monitor ? monitor.getStatus() : {};

    // 历史记录子菜单（最近 10 条）
    const recentHistory = history.slice(-10).reverse();
    const historyItems = recentHistory.length > 0
        ? recentHistory.map((item, index) => ({
            label: `${formatTime(item.timestamp)}  ${item.app} — ${item.title || '(无标题)'}`,
            enabled: false
        }))
        : [{ label: '暂无历史记录', enabled: false }];

    const template = [
        // 状态信息
        {
            label: state.paused ? '⏸ 已暂停' : '🟢 监控中',
            enabled: false,
        },
        {
            label: `轮询次数: ${status.pollCount || 0} | 错误: ${status.errorCount || 0}`,
            enabled: false,
        },
        { type: 'separator' },

        // 暂停/恢复
        {
            label: state.paused ? '▶ 恢复监控' : '⏸ 暂停监控',
            click: () => {
                if (state.paused) {
                    resumeMonitor();
                } else {
                    pauseMonitor();
                }
            }
        },
        { type: 'separator' },

        // 显示模式
        {
            label: '显示模式',
            submenu: [
                {
                    label: '完整 (应用名 + 标题)',
                    type: 'radio',
                    checked: config.displayMode === 'full',
                    click: () => setDisplayMode('full')
                },
                {
                    label: '仅应用名',
                    type: 'radio',
                    checked: config.displayMode === 'app',
                    click: () => setDisplayMode('app')
                },
                {
                    label: '仅窗口标题',
                    type: 'radio',
                    checked: config.displayMode === 'title',
                    click: () => setDisplayMode('title')
                }
            ]
        },

        // 轮询间隔
        {
            label: '更新频率',
            submenu: [
                {
                    label: '极快 (500ms)',
                    type: 'radio',
                    checked: config.interval === 500,
                    click: () => setInterval(500)
                },
                {
                    label: '正常 (1秒)',
                    type: 'radio',
                    checked: config.interval === 1000,
                    click: () => setInterval(1000)
                },
                {
                    label: '慢速 (2秒)',
                    type: 'radio',
                    checked: config.interval === 2000,
                    click: () => setInterval(2000)
                },
                {
                    label: '省电 (5秒)',
                    type: 'radio',
                    checked: config.interval === 5000,
                    click: () => setInterval(5000)
                }
            ]
        },

        // 最大显示长度
        {
            label: '最大显示长度',
            submenu: [
                {
                    label: '30 字符',
                    type: 'radio',
                    checked: config.maxTitleLength === 30,
                    click: () => { config.maxTitleLength = 30; refreshTitle(); }
                },
                {
                    label: '60 字符（默认）',
                    type: 'radio',
                    checked: config.maxTitleLength === 60,
                    click: () => { config.maxTitleLength = 60; refreshTitle(); }
                },
                {
                    label: '100 字符',
                    type: 'radio',
                    checked: config.maxTitleLength === 100,
                    click: () => { config.maxTitleLength = 100; refreshTitle(); }
                },
                {
                    label: '不限制',
                    type: 'radio',
                    checked: config.maxTitleLength === 999,
                    click: () => { config.maxTitleLength = 999; refreshTitle(); }
                }
            ]
        },
        { type: 'separator' },

        // 历史记录
        {
            label: `最近窗口切换 (${recentHistory.length})`,
            submenu: historyItems
        },
        { type: 'separator' },

        // 退出
        {
            label: '退出',
            click: () => {
                if (monitor) {
                    monitor.stop();
                }
                app.quit();
            }
        }
    ];

    return Menu.buildFromTemplate(template);
}

// ===== 控制方法 =====

/**
 * 暂停监控
 */
function pauseMonitor() {
    if (monitor && monitor.isRunning()) {
        monitor.stop();
        state.paused = true;
        tray.setTitle('  ⏸ 已暂停');
        tray.setContextMenu(buildContextMenu());
    }
}

/**
 * 恢复监控
 */
function resumeMonitor() {
    if (monitor && !monitor.isRunning()) {
        state.paused = false;
        monitor.start();
        tray.setContextMenu(buildContextMenu());
    }
}

/**
 * 设置显示模式
 * @param {string} mode - 显示模式: 'full' | 'app' | 'title'
 */
function setDisplayMode(mode) {
    config.displayMode = mode;
    refreshTitle();
    tray.setContextMenu(buildContextMenu());
}

/**
 * 设置轮询间隔
 * @param {number} ms - 毫秒
 */
function setInterval(ms) {
    config.interval = ms;
    // 需要重启监控器以应用新间隔
    if (monitor && monitor.isRunning()) {
        monitor.stop();
        monitor._interval = ms;
        monitor.start();
    }
    tray.setContextMenu(buildContextMenu());
}

/**
 * 刷新状态栏标题（使用当前窗口信息重新格式化）
 */
function refreshTitle() {
    if (state.currentWindow) {
        tray.setTitle(formatTrayTitle(state.currentWindow), { fontType: 'monospacedDigit' });
    }
}

// ===== 应用生命周期 =====

/**
 * 初始化 Tray 和监控器
 */
function initApp() {
    // 隐藏 Dock 图标，成为纯状态栏工具
    if (app.dock) {
        app.dock.hide();
    }

    // 创建 Tray
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('焦点窗口监控');
    tray.setTitle('  启动中...', { fontType: 'monospacedDigit' });

    // 创建监控器
    monitor = new ActiveWindowMonitor({
        interval: config.interval,
        maxHistorySize: 200
    });

    // 监听窗口变化 - 更新状态栏标题
    monitor.on('poll', (windowInfo) => {
        state.currentWindow = windowInfo;
        tray.setTitle(formatTrayTitle(windowInfo), { fontType: 'monospacedDigit' });
    });

    // 窗口变化时刷新菜单（更新历史记录）
    monitor.on('change', () => {
        tray.setContextMenu(buildContextMenu());
    });

    // 错误处理
    monitor.on('error', (error) => {
        console.error(`监控错误: ${error.message}`);
        tray.setTitle('  ⚠ 获取失败');
    });

    // 设置初始右键菜单
    tray.setContextMenu(buildContextMenu());

    // 启动监控
    monitor.start();

    console.log('焦点窗口状态栏工具已启动');
}

// Electron 就绪后初始化
app.whenReady().then(() => {
    initApp();
});

// 所有窗口关闭时不退出（因为是纯 Tray 应用）
app.on('window-all-closed', () => {
    // 纯 Tray 应用无窗口，不做任何处理
});

// 应用退出前清理
app.on('before-quit', () => {
    if (monitor) {
        monitor.stop();
    }
    if (tray) {
        tray.destroy();
    }
});
