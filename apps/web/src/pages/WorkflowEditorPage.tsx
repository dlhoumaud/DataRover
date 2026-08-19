import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type OnConnect,
} from "@xyflow/react";
import type { ActionNode, WorkflowDefinition } from "@datarover/workflow-types";
import { useWorkflow, useUpdateWorkflow } from "../api/workflows";
import { useCreateExecution } from "../api/executions";
import {
  definitionToFlow,
  flowToDefinition,
  generateNodeId,
  createDefaultNode,
  type FlowNode,
  type FlowEdge,
} from "../lib/workflowGraph";
import { useEditorStore } from "../lib/editorStore";
import { nodeTypes } from "../components/nodes/WorkflowNode";
import { NodePalette } from "../components/NodePalette";
import { NodeInspectorPanel } from "../components/NodeInspectorPanel";

export function WorkflowEditorPage(): JSX.Element {
  const { projectId, workflowId } = useParams<{ projectId: string; workflowId: string }>();
  const navigate = useNavigate();

  const { data: workflow, isLoading, isError, error } = useWorkflow(workflowId);
  const updateWorkflow = useUpdateWorkflow(workflowId ?? "");
  const createExecution = useCreateExecution();

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<FlowEdge>([]);
  const [workflowName, setWorkflowName] = useState("");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Guards the initial-population effect below so a background refetch of
  // the same workflow (e.g. react-query's window-focus refetch, or the
  // refetch triggered by useUpdateWorkflow's own onSuccess invalidation)
  // never silently overwrites in-progress local edits. It only re-populates
  // when `workflowId` itself changes.
  const loadedWorkflowIdRef = useRef<string | null>(null);

  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const isDirty = useEditorStore((state) => state.isDirty);
  const selectNode = useEditorStore((state) => state.selectNode);
  const markDirty = useEditorStore((state) => state.markDirty);
  const markClean = useEditorStore((state) => state.markClean);

  useEffect(() => {
    loadedWorkflowIdRef.current = null;
    setHasLoadedOnce(false);
  }, [workflowId]);

  useEffect(() => {
    if (!workflow) {
      return;
    }
    if (loadedWorkflowIdRef.current === workflow.id) {
      return;
    }
    const { nodes: flowNodes, edges: flowEdges } = definitionToFlow(workflow.currentVersion.definition);
    setNodes(flowNodes);
    setEdges(flowEdges);
    setWorkflowName(workflow.name);
    loadedWorkflowIdRef.current = workflow.id;
    setHasLoadedOnce(true);
  }, [workflow, setNodes, setEdges]);

  function handleAddNode(type: ActionNode["type"]): void {
    const existingIds = new Set(nodes.map((flowNode) => flowNode.id));
    const id = generateNodeId(type, existingIds);
    const newNode = createDefaultNode(type, id);
    const lastNode = nodes[nodes.length - 1];
    const position = lastNode
      ? { x: lastNode.position.x + 60, y: lastNode.position.y + 100 }
      : { x: 100, y: 100 };
    const flowNode: FlowNode = { id, type, position, data: { node: newNode } };
    setNodes((current) => [...current, flowNode]);
    markDirty();
  }

  const onConnect: OnConnect = (connection: Connection) => {
    setEdges((current) => addEdge(connection, current));
    markDirty();
  };

  const handleNodesChange: typeof onNodesChangeBase = (changes) => {
    onNodesChangeBase(changes);
    markDirty();
  };

  const handleEdgesChange: typeof onEdgesChangeBase = (changes) => {
    onEdgesChangeBase(changes);
    markDirty();
  };

  const selectedFlowNode = useMemo(
    () => nodes.find((flowNode) => flowNode.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const availableNodeIds = useMemo(
    () => nodes.filter((flowNode) => flowNode.id !== selectedNodeId).map((flowNode) => flowNode.id),
    [nodes, selectedNodeId],
  );

  function handleInspectorChange(updated: ActionNode): void {
    setNodes((current) =>
      current.map((flowNode) =>
        flowNode.id === updated.id ? { ...flowNode, data: { ...flowNode.data, node: updated } } : flowNode,
      ),
    );
    markDirty();
  }

  function buildDefinitionInput(): Omit<WorkflowDefinition, "id"> | null {
    if (!workflow) {
      return null;
    }
    const built = flowToDefinition({
      id: workflow.currentVersion.definition.id,
      name: workflowName,
      startNodeId: workflow.currentVersion.definition.startNodeId,
      nodes,
      edges,
    });
    return {
      name: built.name,
      startNodeId: built.startNodeId,
      nodes: built.nodes,
      edges: built.edges,
    };
  }

  async function handleSave(): Promise<void> {
    if (!workflow || !workflowId) {
      return;
    }
    const definition = buildDefinitionInput();
    if (!definition) {
      return;
    }
    await updateWorkflow.mutateAsync({ name: workflowName, definition });
    markClean();
  }

  async function handleRun(): Promise<void> {
    if (!workflowId) {
      return;
    }
    if (isDirty) {
      await handleSave();
    }
    const execution = await createExecution.mutateAsync(workflowId);
    navigate(`/executions/${execution.id}`);
  }

  if (!workflowId) {
    return <div className="p-6 text-sm text-red-600">Identifiant de workflow manquant.</div>;
  }

  if (isLoading || !hasLoadedOnce) {
    return <div className="p-6 text-sm text-gray-500">Chargement du workflow…</div>;
  }

  if (isError || !workflow) {
    return (
      <div className="p-6 text-sm text-red-600">
        Impossible de charger le workflow{error instanceof Error ? ` : ${error.message}` : "."}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            value={workflowName}
            onChange={(event) => {
              setWorkflowName(event.target.value);
              markDirty();
            }}
            className="rounded-md border border-transparent px-2 py-1 text-lg font-semibold text-gray-900 hover:border-gray-300 focus:border-indigo-400 focus:outline-none"
          />
          {isDirty && (
            <span className="text-xs font-medium text-amber-600">Modifications non enregistrées</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={`/projects/${projectId ?? ""}/workflows/${workflowId}/executions`}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            Historique des exécutions
          </Link>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={updateWorkflow.isPending}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Enregistrer
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={createExecution.isPending || updateWorkflow.isPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Exécuter
          </button>
        </div>
      </header>

      <NodePalette onAddNode={handleAddNode} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <NodeInspectorPanel
          node={selectedFlowNode ? selectedFlowNode.data.node : null}
          availableNodeIds={availableNodeIds}
          onChange={handleInspectorChange}
          onClose={() => selectNode(null)}
        />
      </div>
    </div>
  );
}
