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
} from "lucide-react";
import { useState, useEffect } from "react";

export function UploadProgress() {
  const { tasks, removeTask, clearCompleted } = useUpload();
  const [isExpanded, setIsExpanded] = useState(true);

  const activeTasks = tasks.filter(
    (t) => t.status === "uploading" || t.status === "pending",
  );
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const failedTasks = tasks.filter((t) => t.status === "failed");

  useEffect(() => {
    // Auto-clear completed uploads after 3 seconds if all tasks are done and successful
    if (
      tasks.length > 0 &&
      activeTasks.length === 0 &&
      failedTasks.length === 0
    ) {
      const timer = setTimeout(() => {
        clearCompleted();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [tasks.length, activeTasks.length, failedTasks.length, clearCompleted]);

  if (tasks.length === 0) return null;

  const totalProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
      : 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <div className="bg-[#1a2e1d] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-[#7cb686] animate-spin" />
            <div>
              <p className="text-sm font-medium text-[#e8e4d9]">
                Uploading {activeTasks.length} file
                {activeTasks.length !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-[#e8e4d9]/50">
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
                className="text-xs text-[#e8e4d9]/60 hover:text-[#e8e4d9] h-7 px-2"
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[#e8e4d9]/60 hover:text-[#e8e4d9]"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Overall Progress */}
        {isExpanded && activeTasks.length > 0 && (
          <div className="px-4 py-3 border-b border-white/5 bg-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#e8e4d9]/60">
                Overall Progress
              </span>
              <span className="text-xs font-medium text-[#e8e4d9]">
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
                      <Loader2 className="w-4 h-4 text-[#7cb686] animate-spin" />
                    )}
                    {task.status === "pending" && (
                      <div className="w-4 h-4 rounded-full border-2 border-[#e8e4d9]/20" />
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
                    <p className="text-sm text-[#e8e4d9] truncate">
                      {task.file.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-[#e8e4d9]/40">
                        {(task.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      {task.status === "failed" && task.error && (
                        <p className="text-xs text-red-400">{task.error}</p>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {(task.status === "uploading" ||
                      task.status === "pending") && (
                      <div className="mt-2">
                        <Progress value={task.progress} className="h-1" />
                      </div>
                    )}
                  </div>

                  {/* Remove Button */}
                  {(task.status === "completed" ||
                    task.status === "failed") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTask(task.id)}
                      className="h-6 w-6 text-[#e8e4d9]/40 hover:text-[#e8e4d9]"
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
