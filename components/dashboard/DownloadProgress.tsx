"use client";

import { useDownload } from "@/contexts/DownloadContext";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  Lock,
  Pause,
  PlayCircle,
  PauseCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState, useEffect } from "react";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function DownloadProgress() {
  const {
    tasks,
    pendingResumes,
    cancelDownload,
    removeTask,
    deleteDownload,
    clearCompleted,
    dismissResumes,
  } = useDownload();
  const [isExpanded, setIsExpanded] = useState(true);

  const activeTasks = tasks.filter(
    (t) => t.status === "downloading" || t.status === "decrypting",
  );
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const failedTasks = tasks.filter((t) => t.status === "failed");
  const pausedTasks = tasks.filter((t) => t.status === "paused");

  useEffect(() => {
    // Auto-clear completed downloads after 5 seconds if all tasks are done and successful
    if (
      tasks.length > 0 &&
      activeTasks.length === 0 &&
      failedTasks.length === 0 &&
      pausedTasks.length === 0
    ) {
      const timer = setTimeout(() => {
        clearCompleted();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [
    tasks.length,
    activeTasks.length,
    failedTasks.length,
    pausedTasks.length,
    clearCompleted,
  ]);

  const hasPending = pendingResumes.length > 0;
  const hasTasks = tasks.length > 0;

  if (!hasPending && !hasTasks) return null;

  const totalProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
      : 0;

  return (
    <div className="w-96 max-w-[calc(100vw-2rem)] shrink-0 flex flex-col gap-2">
      {/* ── Pending Resume Banner ─────────────────────────────────────── */}
      {hasPending && (
        <div className="bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
          <div className="px-4 py-3 flex items-start gap-3">
            <RotateCcw className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground">
                {pendingResumes.length === 1
                  ? "1 interrupted download"
                  : `${pendingResumes.length} interrupted downloads`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pendingResumes.length === 1
                  ? `${pendingResumes[0].name} — ${formatBytes(pendingResumes[0].cachedBytes)} saved`
                  : `Click Resume All to continue from where you left off`}
              </p>
              {pendingResumes.length > 1 && (
                <ul className="mt-1.5 space-y-0.5">
                  {pendingResumes.map((r) => (
                    <li
                      key={r.id}
                      className="text-xs text-muted-foreground truncate"
                    >
                      {r.name} — {formatBytes(r.cachedBytes)} saved
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 pb-3">
            <Button
              size="sm"
              className="flex-1 h-8 text-xs bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
              variant="ghost"
              onClick={() => {
                // Fire resume events for all pending IDs
                pendingResumes.forEach((r) => {
                  window.dispatchEvent(
                    new CustomEvent("xenode:resumeDownload", {
                      detail: { id: r.id },
                    }),
                  );
                });
                dismissResumes();
              }}
            >
              <RotateCcw className="w-3 h-3 mr-1.5" />
              Resume All
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground hover:text-card-foreground"
              onClick={dismissResumes}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* ── Active / Completed Task List ──────────────────────────────── */}
      {hasTasks && (
        <div className="bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-3">
              {activeTasks.length > 0 ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : pausedTasks.length > 0 ? (
                <PauseCircle className="w-4 h-4 text-yellow-400" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              )}
              <div>
                <p className="text-sm font-medium text-card-foreground">
                  {activeTasks.length > 0
                    ? `Downloading ${activeTasks.length} file${activeTasks.length !== 1 ? "s" : ""}`
                    : pausedTasks.length > 0
                      ? `${pausedTasks.length} paused`
                      : "Downloads"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {completedTasks.length} completed •{" "}
                  {pausedTasks.length + failedTasks.length} paused/failed
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

          {/* Overall Progress */}
          {isExpanded && activeTasks.length > 0 && (
            <div className="px-4 py-3 border-b border-border bg-muted/20">
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
                  className="px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Status Icon */}
                    <div className="mt-0.5 shrink-0">
                      {task.status === "downloading" && (
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      )}
                      {task.status === "decrypting" && (
                        <Lock className="w-4 h-4 text-primary animate-pulse" />
                      )}
                      {task.status === "paused" && (
                        <Pause className="w-4 h-4 text-yellow-400" />
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
                        {task.name}
                      </p>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-muted-foreground flex items-center flex-wrap gap-2">
                          {task.status === "decrypting" ? (
                            <span className="text-primary font-medium tracking-wide">
                              DECRYPTING…
                            </span>
                          ) : task.status === "paused" ? (
                            <span className="text-yellow-400">
                              Paused at {formatBytes(task.receivedBytes || task.resumeFrom)}
                            </span>
                          ) : task.status === "downloading" ? (
                            <span className="text-primary">
                              {formatBytes(task.receivedBytes || task.resumeFrom)} / {formatBytes(task.size)}
                            </span>
                          ) : (
                            <>{formatBytes(task.size)}</>
                          )}
                        </p>
                        
                        {(task.status === "downloading" || task.status === "decrypting") && (
                           <span className="text-xs font-medium text-muted-foreground">
                             {task.progress}%
                           </span>
                        )}
                      </div>
                      
                      {task.status === "failed" && task.error && (
                        <p className="text-xs text-red-400 mt-1">{task.error}</p>
                      )}

                      {/* Progress Bar */}
                      {(task.status === "downloading" ||
                        task.status === "decrypting") && (
                        <div className="mt-2">
                          <Progress value={task.progress} className="h-1" />
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      {/* Cancel active download (saves cache) */}
                      {(task.status === "downloading" ||
                        task.status === "decrypting") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Pause download (progress is saved)"
                          onClick={() => cancelDownload(task.id)}
                          className="h-6 w-6 text-muted-foreground hover:text-yellow-400"
                        >
                          <Pause className="w-3 h-3" />
                        </Button>
                      )}

                      {/* Resume paused download */}
                      {task.status === "paused" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Resume download"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent("xenode:resumeDownload", {
                                detail: { id: task.id },
                              }),
                            );
                          }}
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                        >
                          <PlayCircle className="w-3 h-3" />
                        </Button>
                      )}

                      {/* Delete active/paused download */}
                      {(task.status === "downloading" ||
                        task.status === "decrypting" ||
                        task.status === "paused") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Cancel and delete download"
                          onClick={() => deleteDownload(task.id)}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}

                      {/* Dismiss completed / failed */}
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
