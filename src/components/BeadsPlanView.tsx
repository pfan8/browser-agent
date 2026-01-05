/**
 * Beads Plan View Component
 *
 * Displays Beads tasks in a hierarchical tree with:
 * - Epic header with progress
 * - Task list with status indicators
 * - Dependency visualization
 * - Merge group brackets
 */

import { useMemo } from 'react';
import type {
    BeadsPlanUI,
    BeadsTaskUI,
    BeadsProgressUI,
} from '../types/beads';
import { findMergeGroups, calculateBeadsProgress } from '../types/beads';
import './BeadsPlanView.css';

interface BeadsPlanViewProps {
    plan: BeadsPlanUI | null;
    isRunning?: boolean;
}

/** Get status icon for a task */
function getStatusIcon(status: BeadsTaskUI['executionStatus']): string {
    switch (status) {
        case 'completed':
            return '✓';
        case 'in_progress':
            return '▶';
        case 'failed':
            return '✗';
        case 'blocked':
            return '⏸';
        case 'pending':
        default:
            return '○';
    }
}

/** Get status color for a task */
function getStatusColor(status: BeadsTaskUI['executionStatus']): string {
    switch (status) {
        case 'completed':
            return '#22c55e';
        case 'in_progress':
            return '#3b82f6';
        case 'failed':
            return '#ef4444';
        case 'blocked':
            return '#6b7280';
        case 'pending':
        default:
            return '#9ca3af';
    }
}

/** Task item component */
function TaskItem({
    task,
    index,
    isInMergeGroup,
    isFirstInGroup,
    isLastInGroup,
}: {
    task: BeadsTaskUI;
    index: number;
    isInMergeGroup: boolean;
    isFirstInGroup: boolean;
    isLastInGroup: boolean;
}) {
    const statusColor = getStatusColor(task.executionStatus);
    const statusIcon = getStatusIcon(task.executionStatus);
    const isBlocked = task.executionStatus === 'blocked';

    return (
        <div
            className={`beads-task ${task.executionStatus} ${
                isInMergeGroup ? 'in-merge-group' : ''
            } ${isFirstInGroup ? 'merge-first' : ''} ${
                isLastInGroup ? 'merge-last' : ''
            }`}
            style={{
                paddingLeft: `${12 + task.depth * 16}px`,
                opacity: isBlocked ? 0.6 : 1,
            }}
        >
            {isInMergeGroup && (
                <div className="merge-bracket">
                    {isFirstInGroup && <div className="bracket-top" />}
                    <div className="bracket-line" />
                    {isLastInGroup && <div className="bracket-bottom" />}
                </div>
            )}
            <span className="task-icon" style={{ color: statusColor }}>
                {statusIcon}
            </span>
            <span className="task-index">{index + 1}.</span>
            <span className="task-title">{task.title}</span>
            {task.isMergeable && !isBlocked && (
                <span className="task-badge mergeable" title="可合并">
                    ⚡
                </span>
            )}
            {task.blockedBy.length > 0 && (
                <span
                    className="task-badge blocked-by"
                    title={`依赖: ${task.blockedBy.join(', ')}`}
                >
                    🔗{task.blockedBy.length}
                </span>
            )}
            {task.error && (
                <span className="task-error" title={task.error}>
                    ⚠️
                </span>
            )}
        </div>
    );
}

/** Progress bar component */
function ProgressBar({ progress }: { progress: BeadsProgressUI }) {
    return (
        <div className="beads-progress">
            <div className="progress-header">
                <span className="progress-label">进度</span>
                <span className="progress-value">{progress.percentage}%</span>
            </div>
            <div className="progress-bar">
                <div
                    className="progress-fill completed"
                    style={{
                        width: `${(progress.completed / progress.total) * 100}%`,
                    }}
                />
                <div
                    className="progress-fill failed"
                    style={{
                        width: `${(progress.failed / progress.total) * 100}%`,
                    }}
                />
            </div>
            <div className="progress-stats">
                <span className="stat completed">
                    {progress.completed} 完成
                </span>
                <span className="stat ready">{progress.ready} 就绪</span>
                <span className="stat pending">{progress.pending} 等待</span>
                {progress.failed > 0 && (
                    <span className="stat failed">{progress.failed} 失败</span>
                )}
            </div>
        </div>
    );
}

/** Epic header component */
function EpicHeader({ plan }: { plan: BeadsPlanUI }) {
    return (
        <div className={`beads-epic-header ${plan.status}`}>
            <div className="epic-title">
                <span className="epic-icon">📋</span>
                <span className="epic-text">{plan.epicTitle}</span>
            </div>
            <div className="epic-count">
                {plan.completedCount}/{plan.totalCount}
            </div>
        </div>
    );
}

/** Task list component */
function TaskList({
    tasks,
    mergeGroupMap,
}: {
    tasks: BeadsTaskUI[];
    mergeGroupMap: Map<number, { isFirst: boolean; isLast: boolean }>;
}) {
    return (
        <div className="beads-task-list">
            {tasks.map((task, index) => {
                const mergeInfo = mergeGroupMap.get(index);
                return (
                    <TaskItem
                        key={task.id}
                        task={task}
                        index={index}
                        isInMergeGroup={!!mergeInfo}
                        isFirstInGroup={mergeInfo?.isFirst ?? false}
                        isLastInGroup={mergeInfo?.isLast ?? false}
                    />
                );
            })}
        </div>
    );
}

/** Running indicator component */
function RunningIndicator() {
    return (
        <div className="beads-running-indicator">
            <span className="spinner" />
            <span>执行中...</span>
        </div>
    );
}

/** Empty state component */
function EmptyState() {
    return (
        <div className="beads-plan-view empty">
            <div className="empty-state">
                <p>暂无任务计划</p>
                <p className="hint">发送任务以创建计划</p>
            </div>
        </div>
    );
}

/** Main BeadsPlanView component */
export function BeadsPlanView({ plan, isRunning }: BeadsPlanViewProps) {
    // Calculate merge groups
    const mergeGroups = useMemo(() => {
        if (!plan) return [];
        return findMergeGroups(plan.tasks);
    }, [plan]);

    // Calculate progress
    const progress = useMemo(() => {
        if (!plan) return null;
        return calculateBeadsProgress(plan.tasks);
    }, [plan]);

    // Create a set of task indices in merge groups for quick lookup
    const mergeGroupMap = useMemo(() => {
        const map = new Map<number, { isFirst: boolean; isLast: boolean }>();
        for (const group of mergeGroups) {
            for (let i = group.startIndex; i <= group.endIndex; i++) {
                map.set(i, {
                    isFirst: i === group.startIndex,
                    isLast: i === group.endIndex,
                });
            }
        }
        return map;
    }, [mergeGroups]);

    if (!plan) {
        return <EmptyState />;
    }

    return (
        <div className="beads-plan-view">
            <EpicHeader plan={plan} />
            {progress && <ProgressBar progress={progress} />}
            <TaskList tasks={plan.tasks} mergeGroupMap={mergeGroupMap} />
            {isRunning && <RunningIndicator />}
        </div>
    );
}

export default BeadsPlanView;
