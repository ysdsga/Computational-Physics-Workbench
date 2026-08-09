import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { workflowsApi } from '../api/client';
import { WORKFLOWS as BUILTIN_WORKFLOWS } from '../data/workflows';
import type { WorkflowTemplate, WorkflowStage, WorkflowStep } from '../types';

interface WorkflowContextValue {
  /** All workflow templates (full, with stages + steps) */
  workflows: WorkflowTemplate[];
  /** Loading state — true while fetching from server */
  loading: boolean;
  /** Reload all templates from server */
  reload: () => Promise<void>;
  /** Save a template (stages + steps) to the server, then reload */
  saveTemplate: (id: string, data: { name?: string; description?: string; stages: WorkflowStage[]; steps: WorkflowStep[] }) => Promise<void>;
  /** Reset a template to its built-in default, then reload */
  resetTemplate: (id: string) => Promise<void>;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>(BUILTIN_WORKFLOWS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const full = await workflowsApi.listFull();
      if (full.length > 0) {
        setWorkflows(full);
      }
      // If server returns empty, keep using built-in defaults
    } catch (err) {
      console.error('[WorkflowContext] Failed to load templates:', err);
      // Keep built-in defaults on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveTemplate = useCallback(async (id: string, data: { name?: string; description?: string; stages: WorkflowStage[]; steps: WorkflowStep[] }) => {
    await workflowsApi.save(id, data);
    await reload();
  }, [reload]);

  const resetTemplate = useCallback(async (id: string) => {
    await workflowsApi.reset(id);
    await reload();
  }, [reload]);

  return (
    <WorkflowContext.Provider value={{ workflows, loading, reload, saveTemplate, resetTemplate }}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflowContext(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflowContext must be used within WorkflowProvider');
  return ctx;
}

/** Get a specific workflow template by ID (reactive — re-renders when templates change) */
export function useWorkflow(workflowId: string): WorkflowTemplate | undefined {
  const { workflows } = useWorkflowContext();
  return workflows.find(w => w.id === workflowId);
}

/** Get all workflow templates (reactive) */
export function useWorkflowList(): WorkflowTemplate[] {
  const { workflows } = useWorkflowContext();
  return workflows;
}

// === Convenience helpers (work on a WorkflowTemplate, no global state) ===

export function getStagesOf(workflow: WorkflowTemplate | undefined): WorkflowStage[] {
  return workflow?.stages ?? [];
}

export function getStepsOf(workflow: WorkflowTemplate | undefined): WorkflowStep[] {
  return workflow?.steps ?? [];
}

export function getStepsForStageOf(workflow: WorkflowTemplate | undefined, stageId: string): WorkflowStep[] {
  return (workflow?.steps ?? []).filter(s => s.stageId === stageId).sort((a, b) => a.order - b.order);
}

export function getStageForStepOf(workflow: WorkflowTemplate | undefined, stepId: string): WorkflowStage | undefined {
  const step = (workflow?.steps ?? []).find(s => s.id === stepId);
  if (!step) return undefined;
  return (workflow?.stages ?? []).find(s => s.id === step.stageId);
}

export function getTotalRequiredStepsOf(workflow: WorkflowTemplate | undefined): number {
  return (workflow?.steps ?? []).filter(s => !s.optional).length;
}
