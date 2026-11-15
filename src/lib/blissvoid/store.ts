"use client";

import { create } from "zustand";

export type AppView =
  | "dashboard"
  | "workflows"
  | "executions"
  | "credentials"
  | "templates"
  | "insights"
  | "settings";

interface AppState {
  /* Route (single-page app shell) */
  view: "landing" | "app";
  appView: AppView;
  editingWorkflowId: string | null;
  viewingExecutionId: string | null;
  commandOpen: boolean;
  aiBuilderOpen: boolean;
  theme: "dark" | "light";
  /* Actions */
  enterApp: (v?: AppView) => void;
  goLanding: () => void;
  setAppView: (v: AppView) => void;
  openWorkflow: (id: string) => void;
  closeEditor: () => void;
  openExecution: (id: string) => void;
  closeExecution: () => void;
  setCommandOpen: (open: boolean) => void;
  setAiBuilderOpen: (open: boolean) => void;
  toggleTheme: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  view: "landing",
  appView: "dashboard",
  editingWorkflowId: null,
  viewingExecutionId: null,
  commandOpen: false,
  aiBuilderOpen: false,
  theme: "dark",
  enterApp: (v) => set({ view: "app", appView: v ?? get().appView }),
  goLanding: () => set({ view: "landing" }),
  setAppView: (v) =>
    set({ appView: v, editingWorkflowId: null, viewingExecutionId: null }),
  openWorkflow: (id) => set({ editingWorkflowId: id }),
  closeEditor: () => set({ editingWorkflowId: null, appView: "workflows" }),
  openExecution: (id) => set({ viewingExecutionId: id }),
  closeExecution: () => set({ viewingExecutionId: null }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setAiBuilderOpen: (open) => set({ aiBuilderOpen: open }),
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next === "dark");
    }
  },
}));
