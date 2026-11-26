import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshGitTask } from "./git-refresh";
import type { Task } from "./types";
import { useUI } from "./ui";

export function useTaskUpdates(tasks: Task[], loading: boolean) {
  const client = useQueryClient();
  const seenTasks = useRef<Map<string, string> | null>(null);
  const refreshedTasks = useRef(new Set<string>());
  const refreshFinished = useCallback((task: Task) => {
    if (refreshedTasks.current.has(task.id)) return;
    refreshedTasks.current.add(task.id);
    if (refreshedTasks.current.size > 256) {
      const oldest = refreshedTasks.current.values().next().value;
      if (oldest) refreshedTasks.current.delete(oldest);
    }
    void refreshGitTask(client, task);
  }, [client]);
  useEffect(() => {
    if (!seenTasks.current) {
      if (!loading)
        seenTasks.current = new Map(tasks.map((t) => [t.id, t.state]));
      return;
    }
    const nextStates = new Map<string, string>();
    for (const task of [...tasks].reverse()) {
      const previous = seenTasks.current.get(task.id);
      const completed = !["queued", "running"].includes(task.state);
      if (previous === undefined || (completed && previous !== task.state)) {
        useUI.getState().notifyTask(task);
        if (completed) refreshFinished(task);
      }
      nextStates.set(task.id, task.state);
    }
    seenTasks.current = nextStates;
  }, [tasks, loading, refreshFinished]);
  return refreshFinished;
}
