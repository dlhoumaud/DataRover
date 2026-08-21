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
  type NodeMouseHandler,
  type OnConnect,
} from "@xyflow/react";
import type {
  ActionNode,
  ExtractionRule,
  ExtractSourceType,
  WorkflowDefinition,
} from "@datarover/workflow-types";
import { useWorkflow, useUpdateWorkflow, useDeleteWorkflow } from "../api/workflows";
import { useCreateExecution } from "../api/executions";
import { useProject } from "../api/projects";
import { getAvailableVariables } from "../lib/templateVariables";
import {
  definitionToFlow,
  findUnreachableNodeIds,
  flowToDefinition,
  generateNodeId,
  createDefaultNode,
  reassignStartNodeId,
  type FlowNode,
  type FlowEdge,
} from "../lib/workflowGraph";
import { useEditorStore } from "../lib/editorStore";
import { nodeTypes } from "../components/nodes/WorkflowNode";
import { NodePalette } from "../components/NodePalette";
import { NodeInspectorPanel } from "../components/NodeInspectorPanel";
import { NodeContextMenu, type NodeContextMenuState } from "../components/NodeContextMenu";
import { SchedulesPanel } from "../components/SchedulesPanel";

export function WorkflowEditorPage(): JSX.Element {
  const { projectId, workflowId } = useParams<{ projectId: string; workflowId: string }>();
  const navigate = useNavigate();

  const { data: workflow, isLoading, isError, error } = useWorkflow(workflowId);
  const { data: project } = useProject(projectId);
  const updateWorkflow = useUpdateWorkflow(workflowId ?? "");
  const deleteWorkflow = useDeleteWorkflow(projectId ?? "");
  const createExecution = useCreateExecution();

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<FlowEdge>([]);
  const [workflowName, setWorkflowName] = useState("");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null);
  const [isSchedulesPanelOpen, setIsSchedulesPanelOpen] = useState(false);

  // Guards the initial-population effect below so a background refetch of
  // the same workflow (e.g. react-query's window-focus refetch, or the
  // refetch triggered by useUpdateWorkflow's own onSuccess invalidation)
  // never silently overwrites in-progress local edits. It only re-populates
  // when `workflowId` itself changes.
  const loadedWorkflowIdRef = useRef<string | null>(null);

  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const isDirty = useEditorStore((state) => state.isDirty);
  const startNodeId = useEditorStore((state) => state.startNodeId);
  const selectNode = useEditorStore((state) => state.selectNode);
  const markDirty = useEditorStore((state) => state.markDirty);
  const markClean = useEditorStore((state) => state.markClean);
  const setStartNodeId = useEditorStore((state) => state.setStartNodeId);

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
    setStartNodeId(workflow.currentVersion.definition.startNodeId);
    loadedWorkflowIdRef.current = workflow.id;
    setHasLoadedOnce(true);
  }, [workflow, setNodes, setEdges, setStartNodeId]);

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

  const onNodeContextMenu: NodeMouseHandler<FlowNode> = (event, node) => {
    event.preventDefault();
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  };

  function handleDuplicateNode(nodeId: string): void {
    const source = nodes.find((flowNode) => flowNode.id === nodeId);
    if (!source) {
      return;
    }
    const existingIds = new Set(nodes.map((flowNode) => flowNode.id));
    const newId = generateNodeId(source.data.node.type, existingIds);
    const clonedNode: ActionNode = { ...source.data.node, id: newId, name: `${source.data.node.name} (copie)` };
    const flowNode: FlowNode = {
      id: newId,
      type: source.type,
      position: { x: source.position.x + 40, y: source.position.y + 40 },
      data: { node: clonedNode },
    };
    setNodes((current) => [...current, flowNode]);
    selectNode(newId);
    markDirty();
  }

  function handleDeleteNode(nodeId: string): void {
    const remainingNodeIds = nodes.filter((flowNode) => flowNode.id !== nodeId).map((flowNode) => flowNode.id);
    setNodes((current) => current.filter((flowNode) => flowNode.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) {
      selectNode(null);
    }
    if (startNodeId !== null) {
      // Deleting the current start node itself needs a replacement — see reassignStartNodeId's
      // own doc comment for why *something* always has to take over.
      setStartNodeId(reassignStartNodeId(remainingNodeIds, nodeId, startNodeId));
    }
    markDirty();
  }

  /** Invoked from the node context menu — see NodeContextMenu's "Définir comme nœud de départ". */
  function handleSetStartNode(nodeId: string): void {
    setStartNodeId(nodeId);
    markDirty();
  }

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

  // Every `{{ }}`-usable reference offered by TemplateInput's autocomplete — see
  // getAvailableVariables's own doc comment for what's included and why (every node's output,
  // every declared project variable; loop-body-only bindings are added separately, inside
  // LoopNodeInspector itself, since they only exist there).
  const templateVariables = useMemo(
    () =>
      getAvailableVariables({
        nodes: nodes.map((flowNode) => flowNode.data.node),
        currentNodeId: selectedNodeId ?? undefined,
        globalVariableKeys: Object.keys(project?.variables ?? {}),
      }),
    [nodes, selectedNodeId, project],
  );

  /**
   * Turns the rules validated in PreviewSelector (Specs.md §6/§8, extended to JSON/XML) into
   * a new `extract` node wired by an edge from the http node that was
   * being previewed, and selects it — mirrors handleAddNode's id
   * generation / positioning conventions.
   */
  function handleCreateExtractNode(rules: ExtractionRule[], sourceType: ExtractSourceType): void {
    if (!selectedNodeId) {
      return;
    }
    const sourceNode = nodes.find((flowNode) => flowNode.id === selectedNodeId);
    if (!sourceNode) {
      return;
    }
    const existingIds = new Set(nodes.map((flowNode) => flowNode.id));
    const id = generateNodeId("extract", existingIds);
    const newNode: ActionNode = {
      id,
      name: "New Extraction",
      type: "extract",
      source: selectedNodeId,
      sourceType,
      rules,
    };
    const position = { x: sourceNode.position.x + 260, y: sourceNode.position.y };
    const flowNode: FlowNode = { id, type: "extract", position, data: { node: newNode } };
    const newEdge: FlowEdge = {
      id: `${selectedNodeId}-${id}-default`,
      source: selectedNodeId,
      target: id,
    };
    setNodes((current) => [...current, flowNode]);
    setEdges((current) => [...current, newEdge]);
    selectNode(id);
    markDirty();
  }

  function handleInspectorChange(updated: ActionNode): void {
    setNodes((current) =>
      current.map((flowNode) =>
        flowNode.id === updated.id ? { ...flowNode, data: { ...flowNode.data, node: updated } } : flowNode,
      ),
    );
    markDirty();
  }

  function buildDefinitionInput(): Omit<WorkflowDefinition, "id"> | null {
    // `startNodeId` is only ever `null` right after deleting a workflow's very last node (see
    // reassignStartNodeId) — an unsaveable, momentary state (WorkflowDefinitionSchema requires
    // at least one node anyway), not something to paper over with a fallback guess here.
    if (!workflow || startNodeId === null) {
      return null;
    }
    const built = flowToDefinition({
      id: workflow.currentVersion.definition.id,
      name: workflowName,
      startNodeId,
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

  function handleDelete(): void {
    if (!workflowId) {
      return;
    }
    const confirmed = window.confirm(
      `Supprimer le workflow "${workflowName}" ? Son historique d'exécutions sera supprimé définitivement.`,
    );
    if (confirmed) {
      deleteWorkflow.mutate(workflowId, {
        onSuccess: () => navigate(`/projects/${projectId ?? ""}`),
      });
    }
  }

  async function handleRun(): Promise<void> {
    if (!workflowId || startNodeId === null) {
      return;
    }
    const unreachable = findUnreachableNodeIds(nodes, edges, startNodeId);
    if (unreachable.length > 0) {
      const names = unreachable
        .map((id) => nodes.find((flowNode) => flowNode.id === id)?.data.node.name ?? id)
        .join(", ");
      const confirmed = window.confirm(
        `Ce(s) nœud(s) ne seront jamais exécutés depuis le nœud de départ actuel : ${names}. ` +
          `Exécuter quand même ?`,
      );
      if (!confirmed) {
        return;
      }
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
    <div className="flex h-full flex-col">
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
            onClick={() => setIsSchedulesPanelOpen(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ⏱ Planification
          </button>
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
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteWorkflow.isPending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Supprimer
          </button>
        </div>
      </header>

      {deleteWorkflow.isError ? (
        <p className="border-b border-gray-200 bg-white px-4 py-2 text-sm text-red-600">
          Une erreur est survenue lors de la suppression du workflow.
        </p>
      ) : null}

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
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={() => setContextMenu(null)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          {contextMenu && (
            <NodeContextMenu
              state={contextMenu}
              isStart={contextMenu.nodeId === startNodeId}
              onDuplicate={handleDuplicateNode}
              onDelete={handleDeleteNode}
              onSetStart={handleSetStartNode}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>

        <NodeInspectorPanel
          node={selectedFlowNode ? selectedFlowNode.data.node : null}
          availableNodeIds={availableNodeIds}
          variables={templateVariables}
          projectId={projectId ?? ""}
          onChange={handleInspectorChange}
          onClose={() => selectNode(null)}
          onCreateExtractNode={handleCreateExtractNode}
        />
      </div>

      {isSchedulesPanelOpen && workflowId && (
        <SchedulesPanel workflowId={workflowId} onClose={() => setIsSchedulesPanelOpen(false)} />
      )}
    </div>
  );
}
