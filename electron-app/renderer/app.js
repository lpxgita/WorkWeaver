/**
 * Work Monitor - 渲染进程前端逻辑
 * 通过 window.api (preload 暴露) 与主进程通信
 */

const App = {
    // 当前活跃页面
    currentPage: 'dashboard',
    // 当前日志 Tab
    currentLogTab: 'screenshot',
    // 当前总结粒度
    currentGranularity: '2min',
    // 缓存的配置
    cachedConfig: null,
    // 状态轮询定时器
    statusTimer: null,

    // ========== 初始化 ==========

    async init() {
        // 绑定侧边栏导航
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                App.navigateTo(page);
            });
        });

        // 绑定页面内交互按钮
        App.bindActions();

        // 监听实时日志
        window.api.onLog((serviceName, entry) => {
            App.appendLogEntry(serviceName, entry);
        });

        // 监听服务状态变更
        window.api.onServiceChange((type, serviceName) => {
            App.refreshStatus();
        });

        // 加载版本号到侧边栏
        try {
            const version = await window.api.getVersion();
            const versionEl = document.getElementById('sidebar-version');
            if (versionEl && version) {
                versionEl.textContent = `v${version}`;
            }
        } catch (err) { console.error('加载版本号失败:', err); }

        // 初始加载（各模块独立容错，避免一个失败导致全部不可用）
        try { await App.refreshStatus(); } catch (err) { console.error('初始化状态失败:', err); }
        try { await App.loadConfigToForm(); } catch (err) { console.error('初始化配置失败:', err); }
        try { await App.loadSummaryDates(); } catch (err) { console.error('初始化总结日期失败:', err); }

        // 定时刷新状态
        App.statusTimer = setInterval(() => App.refreshStatus(), 3000);
    },

    // ========== 事件绑定 ==========

    bindActions() {
        // 仪表盘按钮
        const btnStartScreenshot = document.getElementById('btn-start-screenshot');
        if (btnStartScreenshot) {
            btnStartScreenshot.addEventListener('click', () => App.toggleService('screenshot'));
        }
        const btnStartSummary = document.getElementById('btn-start-summary');
        if (btnStartSummary) {
            btnStartSummary.addEventListener('click', () => App.toggleService('summary'));
        }
        const btnConfigEdit = document.getElementById('btn-config-edit');
        if (btnConfigEdit) {
            btnConfigEdit.addEventListener('click', () => App.navigateTo('config'));
        }

        // 截图页面
        const btnSSToggle = document.getElementById('btn-ss-toggle');
        if (btnSSToggle) {
            btnSSToggle.addEventListener('click', () => App.toggleService('screenshot'));
        }
        const btnSSRefresh = document.getElementById('btn-refresh-screenshots');
        if (btnSSRefresh) {
            btnSSRefresh.addEventListener('click', () => App.refreshScreenshots());
        }
        const btnCleanup = document.getElementById('btn-cleanup-screenshots');
        if (btnCleanup) {
            btnCleanup.addEventListener('click', () => App.cleanupScreenshots());
        }
        const screenshotModal = document.getElementById('screenshot-modal');
        if (screenshotModal) {
            screenshotModal.addEventListener('click', (event) => App.closeScreenshotModal(event));
        }
        const screenshotModalClose = document.querySelector('#screenshot-modal .modal-close');
        if (screenshotModalClose) {
            screenshotModalClose.addEventListener('click', () => App.closeScreenshotModal());
        }

        // AI 总结页面
        const btnSMToggle = document.getElementById('btn-sm-toggle');
        if (btnSMToggle) {
            btnSMToggle.addEventListener('click', () => App.toggleService('summary'));
        }
        const summaryDate = document.getElementById('summary-date');
        if (summaryDate) {
            summaryDate.addEventListener('change', () => App.loadSummaries());
        }
        document.querySelectorAll('#granularity-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const granularity = tab.dataset.granularity;
                App.switchGranularity(granularity);
            });
        });

        // 配置页面
        const configForm = document.getElementById('config-form');
        if (configForm) {
            configForm.addEventListener('submit', (event) => App.saveConfig(event));
        }
        const btnConfigReset = document.getElementById('btn-config-reset');
        if (btnConfigReset) {
            btnConfigReset.addEventListener('click', () => App.loadConfigToForm());
        }

        // Token 统计页面
        const tsDate = document.getElementById('ts-date');
        if (tsDate) {
            tsDate.addEventListener('change', () => App.onTokenStatsDateChange());
        }
        const tsSession = document.getElementById('ts-session');
        if (tsSession) {
            tsSession.addEventListener('change', () => App.loadTokenStats());
        }
        const btnTsFilter = document.getElementById('btn-ts-filter');
        if (btnTsFilter) {
            btnTsFilter.addEventListener('click', () => App.loadTokenStats());
        }
        const btnTsReset = document.getElementById('btn-ts-reset');
        if (btnTsReset) {
            btnTsReset.addEventListener('click', () => App.resetTokenStatsFilter());
        }

        // Todo 页面
        document.querySelectorAll('#todo-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.todoTab;
                App.switchTodoTab(tabName);
            });
        });
        const btnTodoAdd = document.getElementById('btn-todo-add');
        if (btnTodoAdd) {
            btnTodoAdd.addEventListener('click', () => App.addTodo());
        }
        const todoNewTitle = document.getElementById('todo-new-title');
        if (todoNewTitle) {
            todoNewTitle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') App.addTodo();
            });
        }
        const btnBehaviorAdd = document.getElementById('btn-behavior-add');
        if (btnBehaviorAdd) {
            btnBehaviorAdd.addEventListener('click', () => App.addBehavior());
        }
        const behaviorNewName = document.getElementById('behavior-new-name');
        if (behaviorNewName) {
            behaviorNewName.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') App.addBehavior();
            });
        }
        // 任务详情弹窗
        const todoDetailClose = document.getElementById('todo-detail-close');
        if (todoDetailClose) {
            todoDetailClose.addEventListener('click', () => App.closeTodoDetail());
        }
        const todoDetailModal = document.getElementById('todo-detail-modal');
        if (todoDetailModal) {
            todoDetailModal.addEventListener('click', (e) => {
                if (e.target === todoDetailModal) App.closeTodoDetail();
            });
        }
        // 详情弹窗标题重命名按钮
        const todoDetailRenameBtn = document.getElementById('todo-detail-rename-btn');
        if (todoDetailRenameBtn) {
            todoDetailRenameBtn.addEventListener('click', () => {
                const todoId = App._currentDetailTodoId;
                if (!todoId) return;
                const titleEl = document.getElementById('todo-detail-title');
                if (!titleEl) return;
                App.startDetailTitleRename(todoId, titleEl.textContent, titleEl);
            });
        }
        const btnSaveDesc = document.getElementById('btn-todo-save-desc');
        if (btnSaveDesc) {
            btnSaveDesc.addEventListener('click', () => App.saveTodoDescription());
        }
        const btnAddSubtask = document.getElementById('btn-todo-add-subtask');
        if (btnAddSubtask) {
            btnAddSubtask.addEventListener('click', () => App.addSubtask());
        }
        const subtaskTitleInput = document.getElementById('todo-subtask-title');
        if (subtaskTitleInput) {
            subtaskTitleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') App.addSubtask();
            });
        }

        // 日志页面
        document.querySelectorAll('#page-logs [data-log]').forEach(tab => {
            tab.addEventListener('click', () => {
                const logTab = tab.dataset.log;
                App.switchLogTab(logTab);
            });
        });
        const btnLogClear = document.getElementById('btn-log-clear');
        if (btnLogClear) {
            btnLogClear.addEventListener('click', () => App.clearCurrentLogs());
        }
    },

    // ========== 导航 ==========

    navigateTo(page) {
        // 更新侧边栏
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        // 更新页面
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });

        App.currentPage = page;

        // 页面特定的加载
        if (page === 'screenshots') {
            App.refreshScreenshots();
        } else if (page === 'summary') {
            App.loadSummaryDates();
        } else if (page === 'token-stats') {
            App.loadTokenStatsDates();
        } else if (page === 'todo') {
            App.loadTodos();
            App.loadBehaviors();
        } else if (page === 'logs') {
            App.refreshLogs();
        }
    },

    // ========== 服务控制 ==========

    async toggleService(serviceName) {
        try {
            const status = await window.api.getStatus();
            const isRunning = status[serviceName]?.running;

            let result;
            if (isRunning) {
                result = await window.api.stopService(serviceName);
            } else {
                result = await window.api.startService(serviceName);
            }

            if (result.success) {
                App.showToast(isRunning ? '服务已停止' : '服务已启动', 'success');
            } else {
                App.showToast(result.error || '操作失败', 'error');
            }

            // 刷新状态
            setTimeout(() => App.refreshStatus(), 500);
        } catch (err) {
            console.error('服务操作失败:', err);
            App.showToast('服务操作失败: ' + (err.message || '未知错误'), 'error');
        }
    },

    async refreshStatus() {
        try {
            const status = await window.api.getStatus();
            App.updateStatusUI(status);
        } catch (err) {
            console.error('刷新状态失败:', err);
        }
    },

    updateStatusUI(status) {
        // 截图服务
        const ssRunning = status.screenshot?.running;
        const ssBadge = document.getElementById('status-screenshot');
        ssBadge.textContent = ssRunning ? '运行中' : '已停止';
        ssBadge.className = `status-badge ${ssRunning ? 'running' : 'stopped'}`;
        document.getElementById('info-screenshot-pid').textContent = status.screenshot?.pid || '-';
        document.getElementById('info-screenshot-time').textContent =
            status.screenshot?.startTime ? App.formatTime(status.screenshot.startTime) : '-';

        // 截图服务按钮
        const btnSS = document.getElementById('btn-start-screenshot');
        btnSS.textContent = ssRunning ? '停止' : '启动';
        btnSS.className = `btn ${ssRunning ? 'btn-stop' : 'btn-start'}`;

        const btnSSPage = document.getElementById('btn-ss-toggle');
        btnSSPage.textContent = ssRunning ? '停止服务' : '启动服务';
        btnSSPage.className = `btn ${ssRunning ? 'btn-stop' : 'btn-start'}`;

        // AI 总结服务
        const smRunning = status.summary?.running;
        const smBadge = document.getElementById('status-summary');
        smBadge.textContent = smRunning ? '运行中' : '已停止';
        smBadge.className = `status-badge ${smRunning ? 'running' : 'stopped'}`;
        document.getElementById('info-summary-pid').textContent = status.summary?.pid || '-';
        document.getElementById('info-summary-time').textContent =
            status.summary?.startTime ? App.formatTime(status.summary.startTime) : '-';

        // AI 总结服务按钮
        const btnSM = document.getElementById('btn-start-summary');
        btnSM.textContent = smRunning ? '停止' : '启动';
        btnSM.className = `btn ${smRunning ? 'btn-stop' : 'btn-start'}`;

        const btnSMPage = document.getElementById('btn-sm-toggle');
        btnSMPage.textContent = smRunning ? '停止服务' : '启动服务';
        btnSMPage.className = `btn ${smRunning ? 'btn-stop' : 'btn-start'}`;

        // 更新配置信息显示
        App.updateConfigInfo();
    },

    async updateConfigInfo() {
        if (!App.cachedConfig) {
            const res = await window.api.loadConfig();
            if (res.success) {
                App.cachedConfig = res.data;
            } else {
                return;
            }
        }

        const cfg = App.cachedConfig;
        document.getElementById('info-interval').textContent = `${cfg.screenshot?.interval || '-'} 秒`;
        document.getElementById('info-format').textContent = (cfg.screenshot?.format || '-').toUpperCase();
        document.getElementById('info-model').textContent = cfg.gemini?.model || '-';
        document.getElementById('info-schedule').textContent = cfg.schedule?.enabled
            ? `${cfg.schedule.start_time} - ${cfg.schedule.end_time}`
            : '未启用';
    },

    // ========== 截图画廊 ==========

    /**
     * 清理过期截图
     */
    async cleanupScreenshots() {
        const btn = document.getElementById('btn-cleanup-screenshots');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '清理中...';
        }
        try {
            const res = await window.api.cleanupScreenshots();
            if (res.success) {
                const d = res.data;
                const msg = `清理完成：删除 ${d.deleted_folders} 个过期文件夹，稀疏处理 ${d.thinned_folders} 个文件夹，删除 ${d.removed_files} 张多余截图`;
                App.showToast(msg, 'success');
                // 清理后刷新截图列表
                App.refreshScreenshots();
            } else {
                App.showToast('清理失败: ' + res.error, 'error');
            }
        } catch (err) {
            App.showToast('清理出错: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '清理截图';
            }
        }
    },

    async refreshScreenshots() {
        const gallery = document.getElementById('screenshot-gallery');
        const res = await window.api.getRecentScreenshots(24);

        if (!res.success || res.data.length === 0) {
            gallery.innerHTML = `
                <div class="empty-state">
                    <p>暂无截图数据</p>
                    <p class="empty-hint">启动截图服务后将在此展示最新截图</p>
                </div>`;
            return;
        }

        gallery.innerHTML = '';
        for (const ss of res.data) {
            const item = document.createElement('div');
            item.className = 'screenshot-item';
            item.onclick = () => App.showScreenshotPreview(ss);
            item.innerHTML = `
                <img class="screenshot-thumb" src="" alt="截图" data-path="${ss.path}" loading="lazy"/>
                <div class="screenshot-meta">${ss.date} / ${ss.filename}</div>`;
            gallery.appendChild(item);

            // 异步加载缩略图
            App.loadScreenshotThumb(item.querySelector('img'), ss.path);
        }
    },

    async loadScreenshotThumb(imgEl, filepath) {
        const res = await window.api.readScreenshot(filepath);
        if (res.success) {
            imgEl.src = res.data;
        }
    },

    async showScreenshotPreview(ss) {
        const modal = document.getElementById('screenshot-modal');
        const img = document.getElementById('screenshot-preview-img');
        const info = document.getElementById('screenshot-preview-info');

        const res = await window.api.readScreenshot(ss.path);
        if (res.success) {
            img.src = res.data;
            info.textContent = `${ss.date} / ${ss.filename}`;
            modal.style.display = 'flex';
        }
    },

    closeScreenshotModal(event) {
        if (event && event.target !== event.currentTarget) return;
        document.getElementById('screenshot-modal').style.display = 'none';
    },

    // ========== AI 总结 ==========

    async loadSummaryDates() {
        const select = document.getElementById('summary-date');
        const res = await window.api.getSummaryDates();

        // 保留当前选择
        const currentVal = select.value;

        select.innerHTML = '<option value="">选择日期</option>';
        if (res.success && res.data.length > 0) {
            for (const date of res.data) {
                const opt = document.createElement('option');
                opt.value = date;
                opt.textContent = date;
                select.appendChild(opt);
            }
            // 恢复选择或默认选第一个
            if (currentVal && res.data.includes(currentVal)) {
                select.value = currentVal;
            } else {
                select.value = res.data[0];
            }
            App.loadSummaries();
        }
    },

    switchGranularity(granularity) {
        App.currentGranularity = granularity;
        document.querySelectorAll('#granularity-tabs .tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.granularity === granularity);
        });
        App.loadSummaries();
    },

    async loadSummaries() {
        const date = document.getElementById('summary-date').value;
        const list = document.getElementById('summary-list');

        if (!date) {
            list.innerHTML = `
                <div class="empty-state">
                    <p>请选择日期查看总结</p>
                </div>`;
            App.renderSummaryTimeline([]);
            return;
        }

        const res = await window.api.getSummaries(date, App.currentGranularity);

        if (!res.success || res.data.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <p>该日期/粒度暂无总结数据</p>
                </div>`;
            App.renderSummaryTimeline([]);
            return;
        }

        App.renderSummaryTimeline(res.data);

        list.innerHTML = '';
        // 倒序显示，最新的在最上面
        const summaries = [...res.data].reverse();
        for (const s of summaries) {
            const item = document.createElement('div');
            item.className = 'summary-item';

            // 2min 级别：有 category_name 或 core_action（兼容旧数据 task_label）
            if (s.category_name || s.task_label || s.core_action) {
                // 活动归类信息：优先用 category_name（新格式列表），回退到 task_label（旧格式）
                const categoryNames = Array.isArray(s.category_name) ? s.category_name
                    : (typeof s.category_name === 'string' && s.category_name ? [s.category_name]
                    : (Array.isArray(s.task_label) ? s.task_label
                    : (typeof s.task_label === 'string' && s.task_label ? [s.task_label] : [])));
                const categoryTypes = Array.isArray(s.category_type) ? s.category_type
                    : (typeof s.category_type === 'string' && s.category_type ? [s.category_type]
                    : categoryNames.map(() => '行为'));
                // 格式化归类展示：[类型] 名称
                const categoryDisplay = categoryNames.map((name, i) => {
                    const type = i < categoryTypes.length ? categoryTypes[i] : '行为';
                    return `[${type}] ${name}`;
                }).join(', ');

                item.innerHTML = `
                    <div class="summary-time">${App.formatTime(s.timestamp)}</div>
                    <div class="summary-fields">
                        ${App.renderField('活动归类', categoryDisplay)}
                        ${App.renderField('持续时间', s.duration_minutes ? s.duration_minutes + ' 分钟' : null)}
                        ${App.renderField('任务状态', s.task_status)}
                        ${App.renderField('交互类型', s.interaction_mode)}
                        ${App.renderField('操作动作', s.operate_action, true)}
                        ${App.renderField('浏览内容', s.browse_content, true)}
                        ${App.renderField('核心动作', s.core_action, true)}
                        ${App.renderField('上下文', s.context, true)}
                        ${App.renderField('内容变化', s.content_change)}
                        ${App.renderField('进度', s.progress)}
                        ${App.renderField('阻塞', s.blockers)}
                        ${App.renderField('下一步', s.next_intent)}
                        ${App.renderField('置信度', s.confidence)}
                    </div>`;
            // 10min 级别：有 task_main 字段
            } else if (s.task_main) {
                item.innerHTML = `
                    <div class="summary-time">${App.formatTime(s.timestamp)}</div>
                    <div class="summary-fields">
                        ${App.renderField('任务主线', s.task_main, true)}
                        ${App.renderTimeline(s.activity_timeline)}
                        ${App.renderField('关键进展', s.key_progress, true)}
                        ${App.renderField('关键对象', s.key_objects, true)}
                        ${App.renderField('内容变化', s.content_change)}
                        ${App.renderField('阻塞', s.blockers)}
                        ${App.renderField('下一步', s.next_step)}
                        ${App.renderField('置信度', s.confidence)}
                    </div>`;
            // 1h 级别：有 achievements 字段
            } else if (s.achievements) {
                item.innerHTML = `
                    <div class="summary-time">${App.formatTime(s.timestamp)}</div>
                    <div class="summary-fields">
                        ${App.renderField('阶段成果', Array.isArray(s.achievements) ? s.achievements.join('; ') : s.achievements, true)}
                        ${App.renderField('任务链条', s.task_chain, true)}
                        ${App.renderTimeDistribution(s.time_distribution, s.miscellaneous)}
                        ${App.renderField('关键产出', s.key_output, true)}
                        ${App.renderField('阻塞', s.blockers)}
                        ${App.renderField('下一方向', s.next_direction, true)}
                        ${App.renderField('置信度', s.confidence)}
                    </div>`;
            } else if (s.raw_response) {
                item.innerHTML = `
                    <div class="summary-time">${App.formatTime(s.timestamp)}</div>
                    <div class="summary-raw">${App.escapeHtml(s.raw_response)}</div>`;
            } else {
                item.innerHTML = `
                    <div class="summary-time">${App.formatTime(s.timestamp)}</div>
                    <div class="summary-raw">${App.escapeHtml(JSON.stringify(s, null, 2))}</div>`;
            }

            list.appendChild(item);
        }
    },

    /**
     * 渲染 10min 级别的活动时间线（卡片内条状图）
     * 兼容新格式（含 start_time/end_time）和旧格式（仅 label/minutes）
     * @param {Array<{label: string, minutes: number, start_time?: string, end_time?: string}>} timeline - 活动时间线
     * @returns {string} HTML 字符串
     */
    renderTimeline(timeline) {
        if (!timeline || !Array.isArray(timeline) || timeline.length === 0) return '';
        const totalMinutes = timeline.reduce((sum, t) => sum + (t.minutes || 0), 0);
        const bars = timeline.map(t => {
            const pct = totalMinutes > 0 ? Math.round((t.minutes / totalMinutes) * 100) : 0;
            // 新格式显示时间范围
            const timeRange = (t.start_time && t.end_time) ? `${t.start_time}-${t.end_time} ` : '';
            return `
                <div class="timeline-bar-row">
                    <span class="timeline-label">${App.escapeHtml(t.label)}</span>
                    <div class="timeline-bar-track">
                        <div class="timeline-bar-fill" style="width: ${pct}%"></div>
                    </div>
                    <span class="timeline-minutes">${timeRange}${t.minutes}分钟</span>
                </div>`;
        }).join('');
        return `
            <div class="summary-field full-width">
                <span class="summary-field-label">活动时间</span>
                <div class="timeline-bars">${bars}</div>
            </div>`;
    },

    /**
     * 渲染 1h 级别的时间分布和杂项活动
     * @param {Array<{label: string, minutes: number}>} distribution - 主要活动分布
     * @param {Array<{label: string, minutes: number}>} miscellaneous - 杂项活动
     * @returns {string} HTML 字符串
     */
    renderTimeDistribution(distribution, miscellaneous) {
        let html = '';
        // 主要活动
        if (distribution && Array.isArray(distribution) && distribution.length > 0) {
            const items = distribution.map(d =>
                `${App.escapeHtml(d.label)}: ${d.minutes}分钟`
            ).join('; ');
            html += `
                <div class="summary-field full-width">
                    <span class="summary-field-label">时间分布</span>
                    <span class="summary-field-value">${items}</span>
                </div>`;
        }
        // 杂项活动
        if (miscellaneous && Array.isArray(miscellaneous) && miscellaneous.length > 0) {
            const items = miscellaneous.map(m =>
                `${App.escapeHtml(m.label)}: ${m.minutes}分钟`
            ).join('; ');
            html += `
                <div class="summary-field full-width">
                    <span class="summary-field-label">杂项活动</span>
                    <span class="summary-field-value misc-value">${items}</span>
                </div>`;
        }
        return html;
    },

    /**
     * 渲染 10min 级别的时间轴（基于模型给出的 activity_timeline 字段）
     * @param {Array<Object>} summaries - 10min 总结数组（按时间升序）
     */
    /** 缓存的时间线数据，用于筛选后重绘 */
    _timelineData: null,
    _timelineSummaries: null,
    _timelineActiveFilters: null,

    renderSummaryTimeline(summaries) {
        const section = document.getElementById('summary-timeline-section');
        const container = document.getElementById('summary-timeline');
        if (!section || !container) return;

        // 仅在 10min 粒度下展示时间轴
        if (App.currentGranularity !== '10min') {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';

        if (!summaries || summaries.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>暂无时间轴数据</p></div>';
            App._timelineData = null;
            App._timelineSummaries = null;
            App._timelineActiveFilters = null;
            App._renderTimelineFilter([]);
            return;
        }

        // 从所有 10min 总结中提取 activity_timeline 字段
        const data = App.buildSummaryTimelineData(summaries);
        if (!data || data.lanes.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>暂无时间轴数据</p></div>';
            App._timelineData = null;
            App._timelineSummaries = null;
            App._timelineActiveFilters = null;
            App._renderTimelineFilter([]);
            return;
        }

        // 缓存数据
        App._timelineData = data;
        App._timelineSummaries = summaries;
        App._timelineActiveFilters = null; // 默认全部显示

        // 渲染筛选器
        App._renderTimelineFilter(data.lanes);

        // 应用筛选
        App._drawTimeline(data, null);

    },

    /**
     * 渲染时间线筛选器
     * @param {Array} lanes - 泳道数据
     */
    _renderTimelineFilter(lanes) {
        const filterContainer = document.getElementById('timeline-filter');
        const filterList = document.getElementById('timeline-filter-list');
        if (!filterContainer || !filterList) return;

        if (!lanes || lanes.length === 0) {
            filterContainer.style.display = 'none';
            return;
        }

        filterContainer.style.display = '';
        filterList.innerHTML = '';

        // 从泳道中提取唯一的 label + category_type
        const items = [];
        const seen = new Set();
        for (const lane of lanes) {
            const filterKey = lane.filterKey || `${lane.categoryType || '行为'}::${lane.label}`;
            if (!seen.has(filterKey)) {
                seen.add(filterKey);
                items.push({
                    filterKey,
                    label: lane.label,
                    categoryType: lane.categoryType || '行为',
                    subtasks: lane.subtasks || []
                });
            }
        }

        for (const item of items) {
            const chip = document.createElement('label');
            chip.className = 'timeline-filter-chip active';
            const typeClass = item.categoryType === '任务' ? 'type-task' : 'type-behavior';
            const typeLabel = item.categoryType === '任务' ? '任务' : '行为';
            chip.innerHTML = `
                <span class="filter-check"></span>
                <span class="timeline-filter-type ${typeClass}">${typeLabel}</span>
                <span>${App.escapeHtml(item.label)}</span>
            `;
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                App._applyTimelineFilter();
            });
            chip.dataset.filterKey = item.filterKey;
            filterList.appendChild(chip);
        }
    },

    /**
     * 应用时间线筛选
     */
    _applyTimelineFilter() {
        if (!App._timelineData) return;

        const filterList = document.getElementById('timeline-filter-list');
        const activeKeys = new Set();
        filterList.querySelectorAll('.timeline-filter-chip.active').forEach(chip => {
            activeKeys.add(chip.dataset.filterKey);
        });

        // 筛选泳道
        const filteredLanes = App._timelineData.lanes.filter(lane => activeKeys.has(lane.filterKey));

        // 如果只勾选了一个任务，展开其子任务为独立泳道
        const activeChips = filterList.querySelectorAll('.timeline-filter-chip.active');
        let displayLanes = filteredLanes;
        if (activeChips.length === 1 && filteredLanes.length === 1) {
            const theLane = filteredLanes[0];
            if (theLane.categoryType === '任务' && theLane.subtaskSegments && theLane.subtaskSegments.length > 0) {
                // 展开子任务为独立泳道
                displayLanes = theLane.subtaskSegments;
            }
        }

        const filteredData = {
            ...App._timelineData,
            lanes: displayLanes
        };

        App._drawTimeline(filteredData, activeKeys);
    },

    /**
     * 绘制时间线（核心绘制逻辑）
     * @param {Object} data - 时间线数据
     * @param {Set|null} activeFilters - 当前筛选的标签集合（null 表示全部）
     */
    _drawTimeline(data, activeFilters) {
        const container = document.getElementById('summary-timeline');
        if (!container) return;

        if (!data || data.lanes.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>暂无匹配的时间轴数据</p></div>';
            return;
        }

        const pxPerMinute = 6;
        const width = Math.max(300, (data.rangeEnd - data.rangeStart) * pxPerMinute);

        container.innerHTML = '';
        const scroll = document.createElement('div');
        scroll.className = 'summary-timeline-scroll';

        const canvas = document.createElement('div');
        canvas.className = 'summary-timeline-canvas';
        canvas.style.width = `${width}px`;

        const header = document.createElement('div');
        header.className = 'summary-timeline-header-row';

        const body = document.createElement('div');
        body.className = 'summary-timeline-body';

        canvas.appendChild(header);
        canvas.appendChild(body);
        scroll.appendChild(canvas);
        container.appendChild(scroll);

        // 绘制刻度与网格线
        for (let m = data.rangeStart; m <= data.rangeEnd; m += data.tickStep) {
            const left = (m - data.rangeStart) * pxPerMinute;
            const tick = document.createElement('div');
            tick.className = 'summary-timeline-tick';
            tick.style.left = `${left}px`;
            tick.textContent = App.formatMinuteLabel(m);
            header.appendChild(tick);

            const line = document.createElement('div');
            line.className = 'summary-timeline-line';
            line.style.left = `${left}px`;
            canvas.appendChild(line);
        }

        // 按泳道绘制活动条
        for (const lane of data.lanes) {
            const row = document.createElement('div');
            row.className = 'summary-timeline-row';
            const colorIndex = App.hashString(lane.label) % 6;
            const totalMinutes = lane.segments.reduce((sum, seg) => sum + seg.minutes, 0);

            for (let i = 0; i < lane.segments.length; i++) {
                const seg = lane.segments[i];
                const left = (seg.startMinute - data.rangeStart) * pxPerMinute;
                const barWidth = Math.max(6, (seg.endMinute - seg.startMinute) * pxPerMinute);

                const bar = document.createElement('div');
                bar.className = `summary-timeline-bar summary-timeline-color-${colorIndex}`;
                bar.style.left = `${left}px`;
                bar.style.width = `${barWidth}px`;
                bar.title = `${lane.label} ${App.formatMinuteLabel(seg.startMinute)} - ${App.formatMinuteLabel(seg.endMinute)} (${seg.minutes}分钟)` +
                    (lane.segments.length > 1 ? ` | 累计 ${totalMinutes}分钟` : '');

                if (i === 0) {
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'summary-timeline-bar-label';
                    labelSpan.textContent = lane.label;
                    bar.appendChild(labelSpan);
                }

                row.appendChild(bar);
            }

            body.appendChild(row);
        }

        // 绘制时间标记
        const markerMinute = App.getSummaryTimelineMarkerMinute(data.maxEndMinute);
        if (markerMinute >= data.rangeStart && markerMinute <= data.rangeEnd) {
            const left = (markerMinute - data.rangeStart) * pxPerMinute;
            const marker = document.createElement('div');
            marker.className = 'summary-timeline-marker';
            marker.style.left = `${left}px`;

            const label = document.createElement('div');
            label.className = 'summary-timeline-marker-label';
            label.textContent = App.formatMinuteLabel(markerMinute);

            const dot = document.createElement('div');
            dot.className = 'summary-timeline-marker-dot';

            marker.appendChild(label);
            marker.appendChild(dot);
            canvas.appendChild(marker);
        }
    },

    /**
     * 将 HH:MM 格式字符串解析为分钟数
     * @param {string} timeStr - HH:MM 格式时间
     * @returns {number} 一天内的分钟数，解析失败返回 -1
     */
    parseTimeToMinute(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return -1;
        const parts = timeStr.split(':');
        if (parts.length !== 2) return -1;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
        return h * 60 + m;
    },

    /**
     * 从 10min 总结数组中提取 activity_timeline 并构建时间轴数据
     * 支持新格式（含 start_time/end_time）和旧格式（仅 label/minutes）的兼容
     * 相同 label 的活动合并到同一条泳道（lane），一条泳道内可以有多个不连续的时间段
     * @param {Array<Object>} summaries - 10min 总结数组
     * @returns {Object} { lanes, rangeStart, rangeEnd, tickStep, maxEndMinute }
     */
    buildSummaryTimelineData(summaries) {
        const allActivities = [];

        for (const s of summaries) {
            const timeline = s.activity_timeline;
            if (!Array.isArray(timeline)) continue;

            for (const item of timeline) {
                if (!item.label) continue;

                // 新格式：带 start_time / end_time
                if (item.start_time && item.end_time) {
                    const startMinute = App.parseTimeToMinute(item.start_time);
                    const endMinute = App.parseTimeToMinute(item.end_time);
                    if (startMinute < 0 || endMinute < 0 || endMinute <= startMinute) continue;
                    const minutes = item.minutes || (endMinute - startMinute);
                    // 过滤持续时间过短的活动（< 3 分钟）
                    if (minutes < 3) continue;
                    // 旧数据兼容：无 category_type 的默认为"行为"
                    const categoryType = item.category_type || '行为';
                    const laneKey = `${categoryType}::${item.label}`;
                    allActivities.push({
                        label: item.label,
                        laneKey,
                        categoryType,
                        subtasks: item.subtasks || [],
                        startMinute, endMinute, minutes
                    });
                } else if (item.minutes && s.timestamp) {
                    // 旧格式兼容：仅有 label + minutes，通过总结 timestamp 推算
                    const date = new Date(s.timestamp);
                    if (Number.isNaN(date.getTime())) continue;
                    const endMinute = date.getHours() * 60 + date.getMinutes();
                    const startMinute = Math.max(0, endMinute - (item.minutes || 0));
                    if (item.minutes < 3) continue;
                    // 旧数据兼容：无 category_type 的默认为"行为"
                    const categoryType = item.category_type || '行为';
                    const laneKey = `${categoryType}::${item.label}`;
                    allActivities.push({
                        label: item.label,
                        laneKey,
                        categoryType,
                        subtasks: item.subtasks || [],
                        startMinute, endMinute, minutes: item.minutes
                    });
                }
            }
        }

        if (allActivities.length === 0) {
            return { lanes: [], rangeStart: 0, rangeEnd: 0, tickStep: 15, maxEndMinute: 0 };
        }

        // 按 startMinute 排序
        allActivities.sort((a, b) => a.startMinute - b.startMinute);

        // 合并跨多条 10min 总结中的连续同标签活动（间隔 <= 2 分钟视为连续）
        const merged = [];
        for (const act of allActivities) {
            const last = merged[merged.length - 1];
            if (last && last.laneKey === act.laneKey && act.startMinute <= last.endMinute + 2) {
                last.endMinute = Math.max(last.endMinute, act.endMinute);
                last.minutes = last.endMinute - last.startMinute;
                // 合并子任务
                if (act.subtasks) {
                    for (const st of act.subtasks) {
                        if (!last.subtasks.includes(st)) last.subtasks.push(st);
                    }
                }
                continue;
            }
            merged.push({ ...act, subtasks: [...(act.subtasks || [])] });
        }

        // 将活动按 label 分组到泳道（相同 label 的活动共享同一行）
        // 按首次出现顺序排列泳道
        const laneMap = new Map(); // laneKey -> { filterKey, label, categoryType, subtasks, segments, subtaskSegments }
        for (const act of merged) {
            if (!laneMap.has(act.laneKey)) {
                laneMap.set(act.laneKey, {
                    filterKey: act.laneKey,
                    label: act.label,
                    categoryType: act.categoryType || '行为',
                    subtasks: [],
                    segments: [],
                    subtaskSegments: [] // 用于筛选单个任务时展开子任务
                });
            }
            const lane = laneMap.get(act.laneKey);
            // 合并子任务列表
            if (act.subtasks) {
                for (const st of act.subtasks) {
                    if (!lane.subtasks.includes(st)) lane.subtasks.push(st);
                }
                // 为每个子任务记录时间段（用于展开显示）
                for (const st of act.subtasks) {
                    let subtaskLane = lane.subtaskSegments.find(sl => sl.label === st);
                    if (!subtaskLane) {
                        subtaskLane = { label: st, categoryType: '子任务', segments: [], subtasks: [] };
                        lane.subtaskSegments.push(subtaskLane);
                    }
                    subtaskLane.segments.push({
                        startMinute: act.startMinute,
                        endMinute: act.endMinute,
                        minutes: act.minutes
                    });
                }
            }
            lane.segments.push({
                startMinute: act.startMinute,
                endMinute: act.endMinute,
                minutes: act.minutes
            });
        }
        const lanes = Array.from(laneMap.values());

        // 计算所有活动的时间范围
        let minStart = Math.min(...merged.map(a => a.startMinute));
        let maxEnd = Math.max(...merged.map(a => a.endMinute));

        // 扩展到 15 分钟刻度
        const tickStep = 15;
        let rangeStart = Math.floor(minStart / tickStep) * tickStep;
        let rangeEnd = Math.ceil(maxEnd / tickStep) * tickStep;

        // 确保至少 60 分钟范围
        if (rangeEnd - rangeStart < 60) {
            const mid = Math.round((rangeStart + rangeEnd) / 2);
            rangeStart = Math.max(0, mid - 30);
            rangeEnd = Math.min(1440, rangeStart + 60);
            if (rangeEnd - rangeStart < 60) {
                rangeStart = Math.max(0, rangeEnd - 60);
            }
        }

        return {
            lanes,
            rangeStart,
            rangeEnd,
            tickStep,
            maxEndMinute: maxEnd
        };
    },

    /**
     * 获取时间轴标记分钟数
     * @param {number} fallbackMinute - 默认使用的分钟数
     * @returns {number}
     */
    getSummaryTimelineMarkerMinute(fallbackMinute) {
        const dateStr = document.getElementById('summary-date')?.value;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (dateStr && dateStr === todayStr) {
            return now.getHours() * 60 + now.getMinutes();
        }
        return fallbackMinute;
    },

    /**
     * 格式化分钟数为 HH:MM
     * @param {number} minuteOfDay - 分钟数
     * @returns {string}
     */
    formatMinuteLabel(minuteOfDay) {
        const h = Math.floor(minuteOfDay / 60);
        const m = minuteOfDay % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },

    /**
     * 简单哈希，用于颜色映射
     * @param {string} text - 文本
     * @returns {number}
     */
    hashString(text) {
        const str = String(text || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    },

    renderField(label, value, fullWidth = false) {
        if (!value || value === '无' || value === '-') return '';
        return `
            <div class="summary-field${fullWidth ? ' full-width' : ''}">
                <span class="summary-field-label">${label}</span>
                <span class="summary-field-value">${App.escapeHtml(String(value))}</span>
            </div>`;
    },

    // ========== 配置管理 ==========

    async loadConfigToForm() {
        const res = await window.api.loadConfig();
        if (!res.success) {
            App.showToast('加载配置失败: ' + res.error, 'error');
            return;
        }

        const cfg = res.data;
        App.cachedConfig = cfg;

        // 截图设置
        document.getElementById('cfg-interval').value = cfg.screenshot?.interval || 5;
        document.getElementById('cfg-format').value = cfg.screenshot?.format || 'jpeg';
        document.getElementById('cfg-quality').value = cfg.screenshot?.quality || 80;
        document.getElementById('cfg-dimension').value = cfg.screenshot?.dimension || 100;

        // 存储设置
        document.getElementById('cfg-storage-dir').value = cfg.storage?.directory || './screenshots';

        // Gemini 设置
        document.getElementById('cfg-api-key').value = cfg.gemini?.api_key || '';
        document.getElementById('cfg-model').value = cfg.gemini?.model || 'gemini-3-flash-preview';
        document.getElementById('cfg-retries').value = cfg.gemini?.max_retries || 3;

        // 时间调度
        document.getElementById('cfg-schedule-enabled').checked = cfg.schedule?.enabled || false;
        document.getElementById('cfg-start-time').value = cfg.schedule?.start_time || '08:00';
        document.getElementById('cfg-end-time').value = cfg.schedule?.end_time || '22:00';

        // 工作日
        const days = cfg.schedule?.days || [];
        document.querySelectorAll('.cfg-day').forEach(cb => {
            cb.checked = days.includes(cb.value);
        });

        // 停止时间点
        const stopTimes = Array.isArray(cfg.schedule?.stop_times) ? cfg.schedule.stop_times : [];
        const stopTimesInput = document.getElementById('cfg-stop-times');
        if (stopTimesInput) {
            stopTimesInput.value = stopTimes.join(', ');
        }

        // 日志设置
        document.getElementById('cfg-log-level').value = cfg.logging?.level || 'info';
        document.getElementById('cfg-console').checked = cfg.logging?.console !== false;
    },

    async saveConfig(event) {
        event.preventDefault();

        // 从表单收集配置
        const selectedDays = [];
        document.querySelectorAll('.cfg-day:checked').forEach(cb => {
            selectedDays.push(cb.value);
        });

        // 解析停止时间点
        let stopTimes = [];
        try {
            const stopTimesInput = document.getElementById('cfg-stop-times')?.value || '';
            stopTimes = App.parseStopTimesInput(stopTimesInput);
        } catch (err) {
            console.error('停止时间解析失败:', err);
            App.showToast(err.message || '停止时间格式错误', 'error');
            return;
        }

        const config = {
            screenshot: {
                interval: parseInt(document.getElementById('cfg-interval').value) || 5,
                format: document.getElementById('cfg-format').value,
                quality: parseInt(document.getElementById('cfg-quality').value) || 80,
                dimension: parseInt(document.getElementById('cfg-dimension').value) || 100,
                monitors: App.cachedConfig?.screenshot?.monitors || [0]
            },
            storage: {
                directory: document.getElementById('cfg-storage-dir').value,
                naming: App.cachedConfig?.storage?.naming || { pattern: '{date}_{time}_{monitor}' },
                organize_by_date: true
            },
            gemini: {
                api_key: document.getElementById('cfg-api-key').value,
                model: document.getElementById('cfg-model').value,
                max_retries: parseInt(document.getElementById('cfg-retries').value) || 3,
                retry_delay: App.cachedConfig?.gemini?.retry_delay || 2
            },
            summary: App.cachedConfig?.summary || {
                directory: './summaries',
                granularity: {
                    '2min': { enabled: true, history_minutes: 9 },
                    '10min': { enabled: true, history_count: 5 },
                    '1h': { enabled: true, recent_10min_count: 6, earlier_10min_count: 6 }
                }
            },
            schedule: {
                enabled: document.getElementById('cfg-schedule-enabled').checked,
                start_time: document.getElementById('cfg-start-time').value,
                end_time: document.getElementById('cfg-end-time').value,
                days: selectedDays,
                stop_times: stopTimes
            },
            logging: {
                level: document.getElementById('cfg-log-level').value,
                console: document.getElementById('cfg-console').checked,
                screenshot_file: App.cachedConfig?.logging?.screenshot_file || './logs/screenshot.log',
                summary_file: App.cachedConfig?.logging?.summary_file || './logs/ai-summary.log'
            }
        };

        const res = await window.api.saveConfig(config);
        if (res.success) {
            App.cachedConfig = config;
            App.showToast('配置保存成功', 'success');
        } else {
            App.showToast('保存失败: ' + res.error, 'error');
        }
    },

    // ========== 日志 ==========

    switchLogTab(tab) {
        App.currentLogTab = tab;
        document.querySelectorAll('[data-log]').forEach(t => {
            t.classList.toggle('active', t.dataset.log === tab);
        });
        App.refreshLogs();
    },

    async refreshLogs() {
        const container = document.getElementById('log-container');
        try {
            const logs = await window.api.getLogs(App.currentLogTab, 200);

            if (!logs || logs.length === 0) {
                container.innerHTML = '<div class="log-empty">等待日志...</div>';
                return;
            }

            container.innerHTML = '';
            for (const entry of logs) {
                App._appendLogDOM(container, entry);
            }

            // 滚动到底部
            container.scrollTop = container.scrollHeight;
        } catch (err) {
            console.error('刷新日志失败:', err);
            container.innerHTML = `<div class="log-empty">加载日志失败: ${err.message || '未知错误'}</div>`;
        }
    },

    appendLogEntry(serviceName, entry) {
        // 如果当前在日志页面且 Tab 匹配
        if (App.currentPage === 'logs' && App.currentLogTab === serviceName) {
            const container = document.getElementById('log-container');
            // 如果还是空状态，先清除
            const empty = container.querySelector('.log-empty');
            if (empty) empty.remove();

            App._appendLogDOM(container, entry);

            // 自动滚动
            const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
            if (isAtBottom) {
                container.scrollTop = container.scrollHeight;
            }
        }
    },

    _appendLogDOM(container, entry) {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `
            <span class="log-time">${App.formatLogTime(entry.time)}</span>
            <span class="log-level ${entry.level}">[${entry.level}]</span>
            <span class="log-message">${App.escapeHtml(entry.message)}</span>`;
        container.appendChild(div);
    },

    async clearCurrentLogs() {
        await window.api.clearLogs(App.currentLogTab);
        App.refreshLogs();
        App.showToast('日志已清除', 'info');
    },

    // ========== Token 统计 ==========

    /**
     * 加载 token 统计可用日期
     */
    async loadTokenStatsDates() {
        const select = document.getElementById('ts-date');
        const res = await window.api.getTokenStatsDates();

        const currentVal = select.value;
        select.innerHTML = '<option value="">选择日期</option>';

        if (res.success && res.data.length > 0) {
            for (const date of res.data) {
                const opt = document.createElement('option');
                opt.value = date;
                opt.textContent = date;
                select.appendChild(opt);
            }
            // 恢复选择或默认选第一个
            if (currentVal && res.data.includes(currentVal)) {
                select.value = currentVal;
            } else {
                select.value = res.data[0];
            }
            App.onTokenStatsDateChange();
        }
    },

    /**
     * 日期变更时：加载会话列表并刷新统计
     */
    async onTokenStatsDateChange() {
        const date = document.getElementById('ts-date').value;
        const sessionSelect = document.getElementById('ts-session');

        if (!date) {
            sessionSelect.innerHTML = '<option value="">全部会话</option>';
            App.renderTokenStatsEmpty();
            return;
        }

        // 先加载全量数据以获取会话列表
        const res = await window.api.getTokenStats(date, {});
        if (res.success && res.data.sessions && res.data.sessions.length > 0) {
            sessionSelect.innerHTML = '<option value="">全部会话</option>';
            for (const s of res.data.sessions) {
                const opt = document.createElement('option');
                opt.value = s.session_id;
                // 将 session_id（ISO 时间）格式化为简短时间
                const startStr = App.formatTime(s.start_time || s.session_id);
                opt.textContent = `${startStr} (${s.record_count}次)`;
                sessionSelect.appendChild(opt);
            }
            // 默认选中最后一个会话（最近的启动）
            if (res.data.sessions.length > 0) {
                sessionSelect.value = res.data.sessions[res.data.sessions.length - 1].session_id;
            }
        }

        App.loadTokenStats();
    },

    /**
     * 加载并渲染 token 统计数据
     */
    async loadTokenStats() {
        const date = document.getElementById('ts-date').value;
        if (!date) {
            App.renderTokenStatsEmpty();
            return;
        }

        const sessionId = document.getElementById('ts-session').value || undefined;
        const startMinute = document.getElementById('ts-start-minute').value || undefined;
        const endMinute = document.getElementById('ts-end-minute').value || undefined;

        // 将 HH:MM:SS 格式转为 HH:MM
        const formatMinuteValue = (v) => v ? v.substring(0, 5) : undefined;

        const options = {
            sessionId,
            startMinute: formatMinuteValue(startMinute),
            endMinute: formatMinuteValue(endMinute)
        };

        const res = await window.api.getTokenStats(date, options);
        if (!res.success || !res.data) {
            App.renderTokenStatsEmpty();
            return;
        }

        App.renderTokenStats(res.data);
    },

    /**
     * 渲染空的 token 统计状态
     */
    renderTokenStatsEmpty() {
        document.getElementById('ts-total-tokens').textContent = '0';
        document.getElementById('ts-total-calls').textContent = '0 次调用';
        document.getElementById('ts-prompt-tokens').textContent = '0';
        document.getElementById('ts-text-tokens').textContent = '0';
        document.getElementById('ts-image-tokens').textContent = '0';
        document.getElementById('ts-candidates-tokens').textContent = '0';
        document.getElementById('ts-thoughts-tokens').textContent = '0';
        document.getElementById('ts-granularity-grid').innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
        document.getElementById('ts-timeline').innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
    },

    /**
     * 重置筛选条件
     */
    resetTokenStatsFilter() {
        document.getElementById('ts-start-minute').value = '';
        document.getElementById('ts-end-minute').value = '';
        document.getElementById('ts-session').value = '';
        App.loadTokenStats();
    },

    /**
     * 渲染 token 统计数据
     * @param {Object} data - 查询结果
     */
    renderTokenStats(data) {
        const { summary, by_granularity, by_minute } = data;

        // 1. 总览卡片
        document.getElementById('ts-total-tokens').textContent = App.formatNumber(summary.total_tokens);
        document.getElementById('ts-total-calls').textContent = `${summary.count} 次调用`;
        document.getElementById('ts-prompt-tokens').textContent = App.formatNumber(summary.prompt_tokens);
        document.getElementById('ts-text-tokens').textContent = App.formatNumber(summary.prompt_text_tokens);
        document.getElementById('ts-image-tokens').textContent = App.formatNumber(summary.prompt_image_tokens);
        document.getElementById('ts-candidates-tokens').textContent = App.formatNumber(summary.candidates_tokens);
        document.getElementById('ts-thoughts-tokens').textContent = App.formatNumber(summary.thoughts_tokens);

        // 2. 按粒度分类
        const granGrid = document.getElementById('ts-granularity-grid');
        const granularities = [
            { key: '2min', label: '2 分钟总结', badge: 'ts-gran-badge-2min' },
            { key: '10min', label: '10 分钟总结', badge: 'ts-gran-badge-10min' },
            { key: '1h', label: '1 小时总结', badge: 'ts-gran-badge-1h' }
        ];

        let granHtml = '';
        for (const g of granularities) {
            const bucket = by_granularity[g.key];
            if (!bucket || bucket.count === 0) {
                granHtml += `
                    <div class="ts-gran-card">
                        <div class="ts-gran-header">
                            <span class="ts-gran-label">${g.label}</span>
                            <span class="ts-gran-badge ${g.badge}">0次</span>
                        </div>
                        <div class="ts-gran-rows">
                            <div class="ts-gran-row">
                                <span class="ts-gran-row-label">无调用记录</span>
                            </div>
                        </div>
                    </div>`;
                continue;
            }
            granHtml += `
                <div class="ts-gran-card">
                    <div class="ts-gran-header">
                        <span class="ts-gran-label">${g.label}</span>
                        <span class="ts-gran-badge ${g.badge}">${bucket.count}次</span>
                    </div>
                    <div class="ts-gran-rows">
                        <div class="ts-gran-row">
                            <span class="ts-gran-row-label">总 Token</span>
                            <span class="ts-gran-row-value">${App.formatNumber(bucket.total_tokens)}</span>
                        </div>
                        <div class="ts-gran-row">
                            <span class="ts-gran-row-label">输入 (文本)</span>
                            <span class="ts-gran-row-value">${App.formatNumber(bucket.prompt_text_tokens)}</span>
                        </div>
                        <div class="ts-gran-row">
                            <span class="ts-gran-row-label">输入 (图片)</span>
                            <span class="ts-gran-row-value">${App.formatNumber(bucket.prompt_image_tokens)}</span>
                        </div>
                        <div class="ts-gran-row">
                            <span class="ts-gran-row-label">输出</span>
                            <span class="ts-gran-row-value">${App.formatNumber(bucket.candidates_tokens)}</span>
                        </div>
                        <div class="ts-gran-row">
                            <span class="ts-gran-row-label">思考</span>
                            <span class="ts-gran-row-value">${App.formatNumber(bucket.thoughts_tokens)}</span>
                        </div>
                    </div>
                </div>`;
        }
        granGrid.innerHTML = granHtml || '<div class="empty-state"><p>暂无数据</p></div>';

        // 3. 按分钟时间线
        const timeline = document.getElementById('ts-timeline');
        if (!by_minute || by_minute.length === 0) {
            timeline.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
            return;
        }

        // 计算最大 total_tokens 用于条形图缩放
        const maxTotal = Math.max(...by_minute.map(m => m.total_tokens), 1);

        let tlHtml = `
            <div class="ts-timeline-header">
                <div>时间</div>
                <div>Token 分布</div>
                <div class="ts-num-right">总计</div>
                <div class="ts-num-right">输入</div>
                <div class="ts-num-right">输出</div>
                <div class="ts-num-right">调用</div>
            </div>`;

        for (const m of by_minute) {
            const textPct = maxTotal > 0 ? Math.round((m.prompt_text_tokens / maxTotal) * 100) : 0;
            const imagePct = maxTotal > 0 ? Math.round((m.prompt_image_tokens / maxTotal) * 100) : 0;
            const outputPct = maxTotal > 0 ? Math.round((m.candidates_tokens / maxTotal) * 100) : 0;
            const thoughtsPct = maxTotal > 0 ? Math.round((m.thoughts_tokens / maxTotal) * 100) : 0;

            tlHtml += `
                <div class="ts-timeline-row">
                    <div class="ts-time-cell">${m.minute}</div>
                    <div class="ts-bar-container">
                        <div class="ts-bar ts-bar-text" style="width: ${textPct}%" title="文本: ${App.formatNumber(m.prompt_text_tokens)}"></div>
                        <div class="ts-bar ts-bar-image" style="width: ${imagePct}%" title="图片: ${App.formatNumber(m.prompt_image_tokens)}"></div>
                        <div class="ts-bar ts-bar-output" style="width: ${outputPct}%" title="输出: ${App.formatNumber(m.candidates_tokens)}"></div>
                        <div class="ts-bar ts-bar-thoughts" style="width: ${thoughtsPct}%" title="思考: ${App.formatNumber(m.thoughts_tokens)}"></div>
                    </div>
                    <div class="ts-num-right">${App.formatNumber(m.total_tokens)}</div>
                    <div class="ts-num-right">${App.formatNumber(m.prompt_tokens)}</div>
                    <div class="ts-num-right">${App.formatNumber(m.candidates_tokens)}</div>
                    <div class="ts-num-right">${m.count}</div>
                </div>`;
        }

        timeline.innerHTML = tlHtml;
    },

    /**
     * 格式化数字，添加千分位分隔符
     * @param {number} num - 数字
     * @returns {string}
     */
    formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return Number(num).toLocaleString('en-US');
    },

    // ========== 工具函数 ==========

    /**
     * 解析停止时间点输入
     * @param {string} raw - 原始输入
     * @returns {Array<string>} 规范化后的时间数组
     */
    parseStopTimesInput(raw) {
        const text = (raw || '').trim();
        if (!text) return [];
        const tokens = text.split(/[,\s，]+/).map(t => t.trim()).filter(Boolean);
        const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
        const result = [];
        const seen = new Set();
        for (const token of tokens) {
            if (!timeRegex.test(token)) {
                throw new Error(`停止时间格式错误: ${token}`);
            }
            if (!seen.has(token)) {
                seen.add(token);
                result.push(token);
            }
        }
        return result;
    },

    formatTime(isoString) {
        if (!isoString) return '-';
        try {
            const d = new Date(isoString);
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            const s = String(d.getSeconds()).padStart(2, '0');
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${h}:${m}:${s}`;
        } catch {
            return isoString;
        }
    },

    formatLogTime(isoString) {
        if (!isoString) return '';
        try {
            const d = new Date(isoString);
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            const s = String(d.getSeconds()).padStart(2, '0');
            return `${h}:${m}:${s}`;
        } catch {
            return '';
        }
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ========== Todo List ==========

    /** 当前查看详情的任务 ID */
    _currentDetailTodoId: null,

    /**
     * 切换 Todo 页面的 Tab（任务列表 / 行为目录）
     * @param {string} tabName - 'tasks' 或 'behaviors'
     */
    switchTodoTab(tabName) {
        document.querySelectorAll('#todo-tabs .tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.todoTab === tabName);
        });
        document.getElementById('todo-panel-tasks').style.display = tabName === 'tasks' ? '' : 'none';
        document.getElementById('todo-panel-behaviors').style.display = tabName === 'behaviors' ? '' : 'none';
    },

    /**
     * 加载并渲染所有任务
     */
    async loadTodos() {
        try {
            const result = await window.api.getTodos();
            if (!result.success) {
                App.showToast('加载任务失败: ' + result.error, 'error');
                return;
            }
            App.renderTodos(result.data);
        } catch (err) {
            console.error('加载任务失败:', err);
        }
    },

    /**
     * 渲染任务列表
     * @param {Array} todos - 任务数组
     */
    renderTodos(todos) {
        const container = document.getElementById('todo-list');
        if (!todos || todos.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>暂无任务</p>
                    <p class="empty-hint">在上方输入框中创建你的第一个任务</p>
                </div>
            `;
            return;
        }

        // 未完成任务在前，已完成在后
        const sorted = [...todos].sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        container.innerHTML = sorted.map(todo => {
            const completedClass = todo.completed ? ' completed' : '';
            const checkedAttr = todo.completed ? ' checked' : '';
            const childTotal = todo.children ? todo.children.length : 0;
            const childDone = todo.children ? todo.children.filter(c => c.completed).length : 0;
            const subtaskHtml = childTotal > 0
                ? `<span class="todo-subtask-count">${childDone}/${childTotal} 子任务</span>`
                : '';
            const descHint = todo.description ? '<span class="todo-meta-badge">有描述</span>' : '';
            const dateStr = App.formatDate(todo.createdAt);

            return `
                <div class="todo-item${completedClass}" data-todo-id="${todo.id}">
                    <input type="checkbox" class="todo-checkbox" ${checkedAttr}
                        data-action="toggle-todo" data-id="${todo.id}">
                    <div class="todo-content" data-action="open-detail" data-id="${todo.id}">
                        <div class="todo-title">${App.escapeHtml(todo.title)}</div>
                        <div class="todo-meta">
                            <span class="todo-meta-badge">${dateStr}</span>
                            ${descHint}
                            ${subtaskHtml}
                        </div>
                    </div>
                    <div class="todo-actions">
                        <button class="todo-action-btn" data-action="rename-todo" data-id="${todo.id}" data-name="${App.escapeHtml(todo.title)}" title="重命名">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="todo-action-btn" data-action="merge-source" data-type="todo" data-id="${todo.id}" data-name="${App.escapeHtml(todo.title)}" title="合并到...">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                            </svg>
                        </button>
                        <button class="todo-action-btn" data-action="merge-target" data-type="todo" data-id="${todo.id}" data-name="${App.escapeHtml(todo.title)}" title="合并到此" style="display:none; color: var(--accent-green);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 5v14M5 12h14"/>
                            </svg>
                        </button>
                        <button class="todo-action-btn delete" data-action="delete-todo" data-id="${todo.id}" title="删除任务">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // 事件委托：勾选、打开详情、删除
        container.querySelectorAll('[data-action="toggle-todo"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                App.toggleTodoComplete(cb.dataset.id, cb.checked);
            });
        });
        container.querySelectorAll('[data-action="open-detail"]').forEach(el => {
            el.addEventListener('click', () => App.openTodoDetail(el.dataset.id));
        });
        container.querySelectorAll('[data-action="rename-todo"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.startInlineRename('todo', btn.dataset.id, btn.dataset.name, btn.closest('.todo-item'));
            });
        });
        container.querySelectorAll('[data-action="delete-todo"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.deleteTodo(btn.dataset.id);
            });
        });
        container.querySelectorAll('[data-action="merge-source"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.startMerge(btn.dataset.type, btn.dataset.id, btn.dataset.name);
            });
        });
        container.querySelectorAll('[data-action="merge-target"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.executeMerge(btn.dataset.type, btn.dataset.id, btn.dataset.name);
            });
        });

        App._refreshMergeTargetButtons();
    },

    /**
     * 添加新任务
     */
    async addTodo() {
        const input = document.getElementById('todo-new-title');
        const title = input.value.trim();
        if (!title) return;

        try {
            const result = await window.api.createTodo({ title });
            if (result.success) {
                input.value = '';
                App.loadTodos();
            } else {
                App.showToast('创建任务失败: ' + result.error, 'error');
            }
        } catch (err) {
            App.showToast('创建任务失败', 'error');
        }
    },

    /**
     * 切换任务完成状态
     * @param {string} todoId - 任务 ID
     * @param {boolean} completed - 是否完成
     */
    async toggleTodoComplete(todoId, completed) {
        try {
            const result = await window.api.updateTodo(todoId, { completed });
            if (result.success) {
                App.loadTodos();
            }
        } catch (err) {
            App.showToast('更新失败', 'error');
        }
    },

    /**
     * 删除任务
     * @param {string} todoId - 任务 ID
     */
    async deleteTodo(todoId) {
        try {
            const result = await window.api.deleteTodo(todoId);
            if (result.success) {
                if (App._mergeSource && App._mergeSource.sourceType === 'todo' && App._mergeSource.sourceId === todoId) {
                    App.cancelMerge();
                }
                App.loadTodos();
                // 如果正在查看该任务详情，关闭弹窗
                if (App._currentDetailTodoId === todoId) {
                    App.closeTodoDetail();
                }
            }
        } catch (err) {
            App.showToast('删除失败', 'error');
        }
    },

    /**
     * 打开任务详情弹窗
     * @param {string} todoId - 任务 ID
     */
    async openTodoDetail(todoId) {
        App._currentDetailTodoId = todoId;
        try {
            const result = await window.api.getTodos();
            if (!result.success) return;

            const todo = result.data.find(t => t.id === todoId);
            if (!todo) return;

            // 填充详情
            document.getElementById('todo-detail-title').textContent = todo.title;
            document.getElementById('todo-detail-desc').value = todo.description || '';

            // 渲染子任务
            App.renderSubtasks(todo);

            // 显示弹窗
            document.getElementById('todo-detail-modal').style.display = '';
        } catch (err) {
            console.error('打开任务详情失败:', err);
        }
    },

    /**
     * 关闭任务详情弹窗
     */
    closeTodoDetail() {
        document.getElementById('todo-detail-modal').style.display = 'none';
        App._currentDetailTodoId = null;
    },

    /**
     * 保存任务描述
     */
    async saveTodoDescription() {
        const todoId = App._currentDetailTodoId;
        if (!todoId) return;

        const description = document.getElementById('todo-detail-desc').value;
        try {
            const result = await window.api.updateTodo(todoId, { description });
            if (result.success) {
                App.showToast('描述已保存', 'success');
                App.loadTodos();
            } else {
                App.showToast('保存失败: ' + result.error, 'error');
            }
        } catch (err) {
            App.showToast('保存失败', 'error');
        }
    },

    /**
     * 渲染子任务列表
     * @param {Object} todo - 父任务对象
     */
    renderSubtasks(todo) {
        const container = document.getElementById('todo-subtask-list');
        const children = todo.children || [];

        if (children.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:12px;"><p style="font-size:12px;">暂无子任务</p></div>';
            return;
        }

        container.innerHTML = children.map(sub => {
            const completedClass = sub.completed ? ' completed' : '';
            const checkedAttr = sub.completed ? ' checked' : '';
            return `
                <div class="todo-subtask-item${completedClass}" data-subtask-id="${sub.id}">
                    <input type="checkbox" class="todo-checkbox" ${checkedAttr}
                        data-action="toggle-subtask" data-parent-id="${todo.id}" data-id="${sub.id}">
                    <span class="todo-subtask-title">${App.escapeHtml(sub.title)}</span>
                    <button class="todo-subtask-delete" data-action="delete-subtask"
                        data-parent-id="${todo.id}" data-id="${sub.id}" title="删除">&times;</button>
                </div>
            `;
        }).join('');

        // 子任务事件绑定
        container.querySelectorAll('[data-action="toggle-subtask"]').forEach(cb => {
            cb.addEventListener('change', () => {
                App.toggleSubtaskComplete(cb.dataset.parentId, cb.dataset.id, cb.checked);
            });
        });
        container.querySelectorAll('[data-action="delete-subtask"]').forEach(btn => {
            btn.addEventListener('click', () => {
                App.deleteSubtask(btn.dataset.parentId, btn.dataset.id);
            });
        });
    },

    /**
     * 添加子任务
     */
    async addSubtask() {
        const parentId = App._currentDetailTodoId;
        if (!parentId) return;

        const input = document.getElementById('todo-subtask-title');
        const title = input.value.trim();
        if (!title) return;

        try {
            const result = await window.api.createSubtask(parentId, { title });
            if (result.success) {
                input.value = '';
                // 重新加载详情
                App.openTodoDetail(parentId);
                App.loadTodos();
            } else {
                App.showToast('添加子任务失败: ' + result.error, 'error');
            }
        } catch (err) {
            App.showToast('添加子任务失败', 'error');
        }
    },

    /**
     * 切换子任务完成状态
     */
    async toggleSubtaskComplete(parentId, subtaskId, completed) {
        try {
            const result = await window.api.updateSubtask(parentId, subtaskId, { completed });
            if (result.success) {
                App.openTodoDetail(parentId);
                App.loadTodos();
            }
        } catch (err) {
            App.showToast('更新失败', 'error');
        }
    },

    /**
     * 删除子任务
     */
    async deleteSubtask(parentId, subtaskId) {
        try {
            const result = await window.api.deleteSubtask(parentId, subtaskId);
            if (result.success) {
                App.openTodoDetail(parentId);
                App.loadTodos();
            }
        } catch (err) {
            App.showToast('删除子任务失败', 'error');
        }
    },

    // ========== 行为目录 ==========

    /**
     * 加载并渲染所有行为
     */
    async loadBehaviors() {
        try {
            const result = await window.api.getBehaviors();
            if (!result.success) {
                App.showToast('加载行为失败: ' + result.error, 'error');
                return;
            }
            App.renderBehaviors(result.data);
        } catch (err) {
            console.error('加载行为失败:', err);
        }
    },

    /**
     * 渲染行为列表
     * @param {Array} behaviors - 行为数组
     */
    renderBehaviors(behaviors) {
        const container = document.getElementById('behavior-list');
        if (!behaviors || behaviors.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>暂无行为</p>
                    <p class="empty-hint">添加你每天都会进行的常见操作</p>
                </div>
            `;
            return;
        }

        container.innerHTML = behaviors.map(b => {
            const initial = b.name.charAt(0).toUpperCase();
            const desc = b.description ? `<div class="behavior-desc">${App.escapeHtml(b.description)}</div>` : '';
            return `
                <div class="behavior-item" data-behavior-id="${b.id}">
                    <div class="behavior-icon-inner">${initial}</div>
                    <div class="behavior-content">
                        <div class="behavior-name">${App.escapeHtml(b.name)}</div>
                        ${desc}
                    </div>
                    <div class="behavior-actions">
                        <button class="todo-action-btn" data-action="rename-behavior" data-id="${b.id}" data-name="${App.escapeHtml(b.name)}" title="重命名">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="todo-action-btn" data-action="merge-source" data-type="behavior" data-id="${b.id}" data-name="${App.escapeHtml(b.name)}" title="合并到...">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                            </svg>
                        </button>
                        <button class="todo-action-btn" data-action="merge-target" data-type="behavior" data-id="${b.id}" data-name="${App.escapeHtml(b.name)}" title="合并到此" style="display:none; color: var(--accent-green);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 5v14M5 12h14"/>
                            </svg>
                        </button>
                        <button class="todo-action-btn delete" data-action="delete-behavior" data-id="${b.id}" title="删除">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // 事件委托
        container.querySelectorAll('[data-action="rename-behavior"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.startInlineRename('behavior', btn.dataset.id, btn.dataset.name, btn.closest('.behavior-item'));
            });
        });
        container.querySelectorAll('[data-action="delete-behavior"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.deleteBehavior(btn.dataset.id);
            });
        });
        container.querySelectorAll('[data-action="merge-source"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.startMerge(btn.dataset.type, btn.dataset.id, btn.dataset.name);
            });
        });
        container.querySelectorAll('[data-action="merge-target"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                App.executeMerge(btn.dataset.type, btn.dataset.id, btn.dataset.name);
            });
        });

        App._refreshMergeTargetButtons();
    },

    /**
     * 添加新行为
     */
    async addBehavior() {
        const input = document.getElementById('behavior-new-name');
        const name = input.value.trim();
        if (!name) return;

        try {
            const result = await window.api.createBehavior({ name });
            if (result.success) {
                input.value = '';
                App.loadBehaviors();
            } else {
                App.showToast('添加行为失败: ' + result.error, 'error');
            }
        } catch (err) {
            App.showToast('添加行为失败', 'error');
        }
    },

    /**
     * 删除行为
     */
    async deleteBehavior(behaviorId) {
        try {
            const result = await window.api.deleteBehavior(behaviorId);
            if (result.success) {
                if (App._mergeSource && App._mergeSource.sourceType === 'behavior' && App._mergeSource.sourceId === behaviorId) {
                    App.cancelMerge();
                }
                App.loadBehaviors();
            }
        } catch (err) {
            App.showToast('删除行为失败', 'error');
        }
    },

    // ========== 合并操作 ==========

    /** 当前选中的合并源 */
    _mergeSource: null,

    /**
     * 根据当前合并源刷新“合并到此”按钮显隐状态
     */
    _refreshMergeTargetButtons() {
        const source = App._mergeSource;
        document.querySelectorAll('[data-action="merge-target"]').forEach(btn => {
            if (!source) {
                btn.style.display = 'none';
                return;
            }
            const isSelf = btn.dataset.type === source.sourceType && btn.dataset.id === source.sourceId;
            btn.style.display = isSelf ? 'none' : '';
        });
    },

    /**
     * 开始合并操作：选中源项
     * @param {string} sourceType - 'todo' 或 'behavior'
     * @param {string} sourceId - 源 ID
     * @param {string} sourceName - 源名称（用于提示）
     */
    startMerge(sourceType, sourceId, sourceName) {
        if (App._mergeSource &&
            App._mergeSource.sourceType === sourceType &&
            App._mergeSource.sourceId === sourceId) {
            App.cancelMerge();
            App.showToast('已取消合并选择', 'info');
            return;
        }
        App._mergeSource = { sourceType, sourceId, sourceName };
        App.showToast(`已选择"${sourceName}"作为合并源，请点击目标项的合并按钮`, 'info');
        App._refreshMergeTargetButtons();
    },

    /**
     * 执行合并：将源合并到目标
     * @param {string} targetType - 'todo' 或 'behavior'
     * @param {string} targetId - 目标 ID
     * @param {string} targetName - 目标名称
     */
    async executeMerge(targetType, targetId, targetName) {
        const source = App._mergeSource;
        if (!source) {
            App.showToast('请先选择要合并的源项', 'error');
            return;
        }

        if (source.sourceType === targetType && source.sourceId === targetId) {
            App.showToast('不能将项目合并到自身', 'error');
            return;
        }

        const confirmMsg = `确定将"${source.sourceName}"合并到"${targetName}"中吗？\n合并后"${source.sourceName}"将消失，其历史时间数据将归类到"${targetName}"。`;
        if (!confirm(confirmMsg)) {
            return;
        }

        try {
            const result = await window.api.mergeTodoItem({
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                targetType,
                targetId
            });

            if (result.success) {
                App.showToast(`合并成功: "${source.sourceName}" → "${targetName}"`, 'success');
                App.cancelMerge();
                App.loadTodos();
                App.loadBehaviors();
            } else {
                App.showToast('合并失败: ' + result.error, 'error');
            }
        } catch (err) {
            App.showToast('合并失败', 'error');
        }
    },

    /**
     * 取消合并操作
     */
    cancelMerge() {
        App._mergeSource = null;
        App._refreshMergeTargetButtons();
    },

    // ========== 重命名操作 ==========

    /**
     * 启动内联重命名：将标题文本替换为输入框
     * @param {string} type - 'todo' 或 'behavior'
     * @param {string} id - 项目 ID
     * @param {string} currentName - 当前名称
     * @param {HTMLElement} itemEl - 列表项 DOM 元素
     */
    startInlineRename(type, id, currentName, itemEl) {
        if (!itemEl) return;

        // 找到标题元素
        const titleEl = type === 'todo'
            ? itemEl.querySelector('.todo-title')
            : itemEl.querySelector('.behavior-name');
        if (!titleEl) return;

        // 如果已经在编辑中，跳过
        if (titleEl.querySelector('.rename-inline-input')) return;

        const originalText = currentName;

        // 创建内联输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rename-inline-input';
        input.value = originalText;

        // 替换标题文本为输入框
        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.focus();
        input.select();

        // 提交重命名
        const commitRename = async () => {
            const newName = input.value.trim();
            // 如果名称未改变或为空，恢复原始文本
            if (!newName || newName === originalText) {
                titleEl.textContent = originalText;
                return;
            }

            try {
                let result;
                if (type === 'todo') {
                    result = await window.api.renameTodo(id, newName);
                } else {
                    result = await window.api.renameBehavior(id, newName);
                }

                if (result.success) {
                    App.showToast(`已重命名: "${originalText}" → "${newName}"`, 'success');
                    // 刷新列表
                    if (type === 'todo') {
                        App.loadTodos();
                    } else {
                        App.loadBehaviors();
                    }
                } else {
                    App.showToast(`重命名失败: ${result.error}`, 'error');
                    titleEl.textContent = originalText;
                }
            } catch (err) {
                console.error('重命名失败:', err);
                App.showToast('重命名失败', 'error');
                titleEl.textContent = originalText;
            }
        };

        // 按 Enter 提交
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                // 按 Esc 取消
                titleEl.textContent = originalText;
            }
        });

        // 失焦时提交
        input.addEventListener('blur', commitRename, { once: true });
    },

    /**
     * 在详情弹窗标题上启动重命名
     * @param {string} todoId - 任务 ID
     * @param {string} currentTitle - 当前标题
     * @param {HTMLElement} titleEl - 标题 DOM 元素 (h3)
     */
    startDetailTitleRename(todoId, currentTitle, titleEl) {
        if (!titleEl) return;
        // 如果已在编辑中，跳过
        if (titleEl.querySelector('.rename-inline-input')) return;

        const originalText = currentTitle;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rename-inline-input';
        input.value = originalText;
        input.style.fontSize = 'inherit';

        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.focus();
        input.select();

        const commitRename = async () => {
            const newName = input.value.trim();
            if (!newName || newName === originalText) {
                titleEl.textContent = originalText;
                return;
            }

            try {
                const result = await window.api.renameTodo(todoId, newName);
                if (result.success) {
                    titleEl.textContent = newName;
                    App.showToast(`已重命名: "${originalText}" → "${newName}"`, 'success');
                    App.loadTodos();
                } else {
                    App.showToast(`重命名失败: ${result.error}`, 'error');
                    titleEl.textContent = originalText;
                }
            } catch (err) {
                console.error('重命名失败:', err);
                App.showToast('重命名失败', 'error');
                titleEl.textContent = originalText;
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                titleEl.textContent = originalText;
            }
        });

        input.addEventListener('blur', commitRename, { once: true });
    },

    /**
     * 格式化日期为简短显示
     * @param {string} isoString - ISO 日期字符串
     * @returns {string} 格式化后的日期
     */
    formatDate(isoString) {
        try {
            const d = new Date(isoString);
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            const hour = d.getHours().toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
            return `${month}-${day} ${hour}:${min}`;
        } catch {
            return '';
        }
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());
