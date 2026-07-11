"use client";

import { useUpload } from "@/contexts/UploadContext";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  PauseCircle,
  RotateCw,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

export function UploadProgress() {
  const {
    tasks,
    isPaused,
    removeTask,
    cancelTask,
    clearCompleted,
    retryTask,
  } = useUpload();
  const [isExpanded, setIsExpanded] = useState(true);

  const activeTasks = tasks.filter(
    (t) =>
      t.status === "uploading" ||
      t.status === "pending" ||
      t.status === "paused",
  );
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const failedTasks = tasks.filter((t) => t.status === "failed");

  // Removed auto-clear completed uploads effect to let users close it manually

  if (tasks.length === 0) return null;

  const totalProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
      : 0;

  return (
    <div className="w-96 max-w-[calc(100vw-2rem)] shrink-0">
      <div className="bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            {activeTasks.length > 0 ? (
              isPaused ? (
                <PauseCircle className="w-4 h-4 text-amber-500" />
              ) : (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              )
            ) : (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            )}
            <div>
              <p className="text-sm font-medium text-card-foreground">
                Uploading {activeTasks.length} file
                {activeTasks.length !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {completedTasks.length} completed • {failedTasks.length} failed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {completedTasks.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  clearCompleted();
                }}
                className="text-xs text-muted-foreground hover:text-card-foreground h-7 px-2"
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-card-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Paused banner */}
        {isExpanded && isPaused && activeTasks.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-amber-500/10">
            <WifiOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-xs text-amber-500">
              Paused — will resume automatically when back online / in the
              foreground.
            </span>
          </div>
        )}

        {/* Overall Progress */}
        {isExpanded && activeTasks.length > 0 && (
          <div className="px-4 py-3 border-b border-white/5 bg-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Overall Progress
              </span>
              <span className="text-xs font-medium text-card-foreground">
                {totalProgress}%
              </span>
            </div>
            <Progress value={totalProgress} className="h-1.5" />
          </div>
        )}

        {/* Task List */}
        {isExpanded && (
          <div className="max-h-80 overflow-y-auto">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Status Icon */}
                  <div className="mt-0.5">
                    {task.status === "uploading" && (
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    )}
                    {task.status === "pending" && (
                      <div className="w-4 h-4 rounded-full border-2 border-primary/20" />
                    )}
                    {task.status === "paused" && (
                      <PauseCircle className="w-4 h-4 text-amber-500" />
                    )}
                    {task.status === "completed" && (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    )}
                    {task.status === "failed" && (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-card-foreground truncate">
                      {task.file.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-muted-foreground">
                        {(task.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      {task.status === "failed" && task.error && (
                        <p className="text-xs text-red-400">{task.error}</p>
                      )}
                    </div>

                    {/* Status text for current step */}
                    {task.statusText &&
                      (task.status === "uploading" ||
                        task.status === "pending" ||
                        task.status === "paused") && (
                        <p
                          className={`text-xs mt-1 ${
                            task.status === "paused"
                              ? "text-amber-500"
                              : "text-primary/80 animate-pulse"
                          }`}
                        >
                          {task.statusText}
                        </p>
                      )}

                    {/* Progress Bar */}
                    {(task.status === "uploading" ||
                      task.status === "pending" ||
                      task.status === "paused") && (
                      <div className="mt-2">
                        <Progress value={task.progress} className="h-1" />
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {(task.status === "uploading" ||
                    task.status === "pending" ||
                    task.status === "paused") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cancelTask(task.id)}
                      className="h-6 w-6 text-muted-foreground hover:text-card-foreground"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                  {task.status === "failed" && !task.interrupted && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => retryTask(task.id)}
                      className="h-6 w-6 text-muted-foreground hover:text-primary"
                      title="Retry"
                    >
                      <RotateCw className="w-3 h-3" />
                    </Button>
                  )}
                  {(task.status === "completed" ||
                    task.status === "failed") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTask(task.id)}
                      className="h-6 w-6 text-muted-foreground hover:text-card-foreground"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
