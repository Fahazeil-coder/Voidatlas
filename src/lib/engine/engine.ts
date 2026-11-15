import { db } from "@/lib/db";
import { NODE_MAP } from "@/lib/blissvoid/node-catalog";
import { mapExecution, safeParse } from "@/lib/blissvoid/dto";
import type { ExecutionDTO, WorkflowEdge, WorkflowNode } from "@/lib/blissvoid/types";
import {
  createRunContext,
  executeNode,
  sleep,
  type Item,
  type NodeResult,
  type TriggerData,
} from "./executors";

/* ---------------------------------------------------------------------------
   BLISSVOID execution engine.
   startExecution() creates the run row and returns immediately; the actual
   wave-based traversal runs in the background so the UI can poll progress.
--------------------------------------------------------------------------- */

const MAX_NODE_RUNS = 40;
const AI_COST_PER_TOKEN = 0.000003;

export interface StartExecutionOptions {
  mode?: string;
  inputItems?: Item[];
  triggerData?: TriggerData;
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super("Workflow not found");
    this.name = "WorkflowNotFoundError";
  }
}

export async function startExecution(
  workflowId: string,
  opts: StartExecutionOptions = {}
): Promise<ExecutionDTO> {
  const workflow = await db.workflow.findFirst({
    where: { id: workflowId, deletedAt: null },
  });
  if (!workflow) throw new WorkflowNotFoundError();

  const nodes = safeParse<WorkflowNode[]>(workflow.nodes, []);
  const edges = safeParse<WorkflowEdge[]>(workflow.edges, []);
  const firstTrigger = nodes.find((n) => NODE_MAP[n.type]?.category === "trigger");
  const triggerType = firstTrigger?.type ?? "manual";

  const execution = await db.execution.create({
    data: {
      workflowId,
      status: "running",
      mode: opts.mode ?? "manual",
      triggerType,
      startedAt: new Date(),
    },
  });

  // Fire-and-forget: the API returns instantly, the UI polls for progress.
  void runExecution(execution.id, workflow.id, workflow.name, nodes, edges, opts).catch(
    (err) => {
      console.error(
        "[blissvoid] runExecution crashed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return mapExecution({ ...execution, workflow });
}

/* ------------------------------- Serialization ---------------------------- */

function serializePayload(value: unknown, max = 15000): string | null {
  if (value === null || value === undefined) return null;
  try {
    let json = JSON.stringify(value);
    if (json.length <= max) return json;
    if (Array.isArray(value)) {
      for (let n = value.length - 1; n > 0; n--) {
        json = JSON.stringify(value.slice(0, n));
        if (json.length <= max - 300) {
          return JSON.stringify([
            ...value.slice(0, n),
            { truncated: true, omitted: value.length - n },
          ]);
        }
      }
    }
    return JSON.stringify({ truncated: true, note: "Payload too large to store" });
  } catch {
    return JSON.stringify({ truncated: true, note: "Payload not serializable" });
  }
}

function flattenResult(result: NodeResult): Item[] {
  if (Array.isArray(result)) return result;
  return Object.values(result).flat();
}

function displayOutput(result: NodeResult): unknown {
  if (Array.isArray(result)) return result;
  return Object.entries(result).map(([handle, items]) => ({ handle, items }));
}

/* ------------------------------ The traversal ----------------------------- */

async function runExecution(
  executionId: string,
  workflowId: string,
  workflowName: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  opts: StartExecutionOptions
): Promise<void> {
  const runStartedAt = new Date();
  let finalized = false;

  const finalizeError = async (message: string) => {
    if (finalized) return;
    finalized = true;
    const finishedAt = new Date();
    await db.execution
      .update({
        where: { id: executionId },
        data: {
          status: "error",
          error: message,
          finishedAt,
          durationMs: finishedAt.getTime() - runStartedAt.getTime(),
        },
      })
      .catch(() => undefined);
  };

  try {
    const variableRows = await db.variable.findMany();
    const vars: Record<string, string> = {};
    for (const v of variableRows) vars[v.key] = v.value;

    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const edgesBySource = new Map<string, WorkflowEdge[]>();
    const inEdges = new Map<string, WorkflowEdge[]>();
    for (const edge of edges) {
      if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
      const sourceList = edgesBySource.get(edge.source) ?? [];
      sourceList.push(edge);
      edgesBySource.set(edge.source, sourceList);
      const targetList = inEdges.get(edge.target) ?? [];
      targetList.push(edge);
      inEdges.set(edge.target, targetList);
    }

    const startNode = nodes.find((n) => NODE_MAP[n.type]?.category === "trigger") ?? nodes[0];
    const startNodeId = startNode?.id ?? "";

    const nodeOutputs = new Map<string, NodeResult>();
    const nodeByName = new Map<string, Item[]>();
    const edgeData = new Map<string, Item[]>();
    const firedEdges = new Set<string>();
    const aiUsage: { tokensIn: number; tokensOut: number }[] = [];

    const runCtx = createRunContext({
      nodeOutputs,
      nodeByName,
      vars,
      triggerData: opts.triggerData,
      recordAiUsage: (tokensIn, tokensOut) => aiUsage.push({ tokensIn, tokensOut }),
    });

    const pending = new Set(nodes.map((n) => n.id));
    let nodeExecutionCount = 0;
    let hardFailMessage: string | null = null;

    const fireOutgoing = (nodeId: string, result: NodeResult) => {
      nodeOutputs.set(nodeId, result);
      const flat = flattenResult(result);
      const node = nodesById.get(nodeId);
      if (node) nodeByName.set(node.name, flat);
      for (const edge of edgesBySource.get(nodeId) ?? []) {
        let items: Item[] | undefined;
        if (Array.isArray(result)) {
          items = result;
        } else {
          const handle = edge.sourceHandle ?? "main";
          items = result[handle];
          if (items === undefined) {
            if (result.main !== undefined) items = result.main;
            else {
              const keys = Object.keys(result);
              items = keys.length === 1 ? result[keys[0]] : [];
            }
          }
        }
        edgeData.set(edge.id, items ?? []);
        firedEdges.add(edge.id);
      }
    };

    while (pending.size > 0 && !hardFailMessage && nodeExecutionCount < MAX_NODE_RUNS) {
      const ready: string[] = [];
      for (const nodeId of pending) {
        const incoming = inEdges.get(nodeId) ?? [];
        if (incoming.length === 0) {
          if (nodeId === startNodeId) ready.push(nodeId);
        } else if (incoming.every((e) => firedEdges.has(e.id))) {
          ready.push(nodeId);
        }
      }
      if (ready.length === 0) break; // unreachable remainder

      for (const nodeId of ready) {
        if (hardFailMessage || nodeExecutionCount >= MAX_NODE_RUNS) break;
        pending.delete(nodeId);
        nodeExecutionCount += 1;
        const node = nodesById.get(nodeId);
        if (!node) continue;

        const incoming = inEdges.get(nodeId) ?? [];

        /* -------- Gather input items -------- */
        let inputItems: Item[] = [];
        const overrideInput =
          nodeId === startNodeId && opts.inputItems && opts.inputItems.length > 0;
        if (overrideInput && NODE_MAP[node.type]?.category === "trigger") {
          inputItems = [];
        } else if (overrideInput) {
          inputItems = opts.inputItems ?? [];
        } else {
          const arrays = incoming.map((e) => edgeData.get(e.id) ?? []);
          if (node.type === "merge" && node.parameters?.mode === "combine") {
            const maxLen = arrays.reduce((m, a) => Math.max(m, a.length), 0);
            inputItems = Array.from({ length: maxLen }, (_, i) => ({
              json: Object.assign({}, ...arrays.map((a) => a[i]?.json ?? {})),
            }));
          } else {
            for (const arr of arrays) inputItems = inputItems.concat(arr);
          }
        }

        const outEdges = edgesBySource.get(nodeId) ?? [];

        /* -------- Pinned data -------- */
        const pinned = Array.isArray(node.pinnedData) ? node.pinnedData : null;
        if (pinned && pinned.length > 0) {
          const items: Item[] = pinned.map((entry) =>
            entry && typeof entry === "object" && "json" in (entry as Record<string, unknown>)
              ? { json: (entry as { json: Record<string, unknown> }).json ?? {} }
              : { json: (entry ?? {}) as Record<string, unknown> }
          );
          await db.nodeRun.create({
            data: {
              executionId,
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              status: "success",
              startedAt: new Date(),
              durationMs: 0,
              inputJson: serializePayload(inputItems),
              outputJson: serializePayload(items),
              error: null,
            },
          });
          fireOutgoing(nodeId, items);
          continue;
        }

        /* -------- No items incoming: skip with a note -------- */
        const isStart = nodeId === startNodeId;
        const triggerOverride =
          isStart && NODE_MAP[node.type]?.category === "trigger" && opts.inputItems && opts.inputItems.length > 0;
        if (!isStart && inputItems.length === 0) {
          await db.nodeRun.create({
            data: {
              executionId,
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              status: "success",
              startedAt: new Date(),
              durationMs: 0,
              inputJson: serializePayload([]),
              outputJson: serializePayload([{ json: { note: "skipped (no items)" } }]),
            },
          });
          fireOutgoing(nodeId, []);
          continue;
        }

        /* -------- Disabled node: pass items through -------- */
        if (node.disabled) {
          await db.nodeRun.create({
            data: {
              executionId,
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              status: "success",
              startedAt: new Date(),
              durationMs: 0,
              inputJson: serializePayload(inputItems),
              outputJson: serializePayload(inputItems),
              error: null,
            },
          });
          fireOutgoing(nodeId, inputItems);
          continue;
        }

        /* -------- Real execution (with retries) -------- */
        const nodeRunRow = await db.nodeRun.create({
          data: {
            executionId,
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            status: "running",
            startedAt: new Date(),
            inputJson: serializePayload(inputItems),
          },
        });

        const isTrigger = NODE_MAP[node.type]?.category === "trigger";
        await sleep(isTrigger ? 250 : 350 + Math.floor(Math.random() * 300));

        const nodeStart = Date.now();

        // Trigger nodes with explicit input items emit them directly.
        if (triggerOverride) {
          const emitted = opts.inputItems ?? [];
          await db.nodeRun.update({
            where: { id: nodeRunRow.id },
            data: {
              status: "success",
              durationMs: Date.now() - nodeStart,
              outputJson: serializePayload(emitted),
            },
          });
          fireOutgoing(nodeId, emitted);
          continue;
        }

        const settings = node.settings ?? {};
        const attempts = settings.retry ? Math.max(1, settings.maxRetries ?? 2) + 1 : 1;
        let result: NodeResult | null = null;
        let lastError: Error | null = null;
        let finalAttempt = 1;

        for (let attempt = 1; attempt <= attempts; attempt++) {
          finalAttempt = attempt;
          try {
            result = await executeNode(node, inputItems, runCtx);
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < attempts) {
              await sleep(400 * Math.pow(2, attempt - 1));
            }
          }
        }

        if (result) {
          await db.nodeRun.update({
            where: { id: nodeRunRow.id },
            data: {
              status: "success",
              durationMs: Date.now() - nodeStart,
              outputJson: serializePayload(displayOutput(result)),
              attempt: finalAttempt,
            },
          });
          fireOutgoing(nodeId, result);
        } else {
          const message = lastError?.message ?? "Unknown node error";
          await db.nodeRun.update({
            where: { id: nodeRunRow.id },
            data: {
              status: "error",
              durationMs: Date.now() - nodeStart,
              error: message,
              attempt: finalAttempt,
            },
          });
          if (settings.continueOnFail) {
            fireOutgoing(nodeId, []);
          } else {
            hardFailMessage = `${node.name} (${node.type}): ${message}`;
          }
        }
      }
    }

    /* -------- Finalize the execution -------- */
    const finishedAt = new Date();
    const totalTokens = aiUsage.reduce((sum, u) => sum + u.tokensIn + u.tokensOut, 0);
    const totalCost = Math.round(totalTokens * AI_COST_PER_TOKEN * 1e9) / 1e9;
    const exceededLimit = nodeExecutionCount >= MAX_NODE_RUNS && pending.size > 0;
    const status = hardFailMessage || exceededLimit ? "error" : "success";

    finalized = true;
    await db.execution.update({
      where: { id: executionId },
      data: {
        status,
        error: hardFailMessage ?? (exceededLimit ? `Stopped: exceeded ${MAX_NODE_RUNS} node executions` : null),
        finishedAt,
        durationMs: finishedAt.getTime() - runStartedAt.getTime(),
        aiTokens: totalTokens,
        aiCost: totalCost,
      },
    });

    if (aiUsage.length > 0) {
      await db.aiUsage.createMany({
        data: aiUsage.map((u) => ({
          executionId,
          provider: "bliss",
          model: "bliss-1",
          tokensIn: u.tokensIn,
          tokensOut: u.tokensOut,
          cost: Math.round((u.tokensIn + u.tokensOut) * AI_COST_PER_TOKEN * 1e9) / 1e9,
        })),
      });
    }

    await db.activityLog.create({
      data: {
        kind: "workflow.run",
        message:
          status === "success"
            ? `"${workflowName}" completed in ${((finishedAt.getTime() - runStartedAt.getTime()) / 1000).toFixed(1)}s across ${nodeExecutionCount} node${nodeExecutionCount === 1 ? "" : "s"}`
            : `"${workflowName}" failed — ${hardFailMessage ?? "run limit reached"}`,
        workflowId,
      },
    });
  } catch (err) {
    console.error(
      "[blissvoid] runExecution error:",
      err instanceof Error ? err.message : String(err)
    );
    await finalizeError(err instanceof Error ? err.message : String(err));
  }
}
