import { Graph, layout as layoutGraph } from '@dagrejs/dagre'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useId, useMemo } from 'react'
import type { StageState, WorkflowState } from '../../domain/types.ts'
import {
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { cx } from '../cx.ts'
import styles from './roadmap.module.css'

const NODE_WIDTH = 210
const NODE_HEIGHT = 76

type StageNodeData = {
  stageId: string
  number: number
  name: string
  state: StageState
  isCurrent: boolean
  /** Shown in Properties. */
  isSelected: boolean
}

type StageFlowNode = Node<StageNodeData, 'stage'>

// Each node is a real button so stages are reachable with Tab; React Flow's
// own node focus is off to avoid a second, non-activating tab stop. Its click,
// from the pointer or from Enter, reaches React Flow's onNodeClick.
function StageNode({ data }: NodeProps<StageFlowNode>) {
  return (
    <div
      className={cx(
        styles.node,
        data.isCurrent && styles.nodeCurrent,
        data.isSelected && styles.nodeSelected,
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={styles.handle}
      />
      <button
        type="button"
        className={styles.nodeButton}
        aria-current={data.isCurrent ? 'step' : undefined}
        aria-pressed={data.isSelected}
      >
        <span className={styles.nodeTitle}>
          <span className={styles.nodeNumber}>{data.number}</span>
          {data.name}
        </span>
        <StateBadge state={data.state} />
      </button>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={styles.handle}
      />
    </div>
  )
}

const nodeTypes = { stage: StageNode }

function layoutWorkflow(
  workflow: WorkflowState,
  states: Record<string, StageState>,
  selectedId: string | null,
): { nodes: StageFlowNode[]; edges: Edge[] } {
  const graph = new Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 44 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const id of workflow.stageIds) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of workflow.edges) graph.setEdge(edge.from, edge.to)
  layoutGraph(graph)

  const nodes = workflow.stageIds.flatMap((id, index): StageFlowNode[] => {
    const stage = workflow.stages[id]
    if (!stage) return []
    // dagre types node labels loosely; layout() has assigned centre coordinates.
    const point = graph.node(id) as { x: number; y: number }
    return [
      {
        id,
        type: 'stage',
        position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
        data: {
          stageId: id,
          number: index + 1,
          name: stage.name,
          state: states[id] ?? 'future',
          isCurrent: workflow.currentStageId === id,
          isSelected: selectedId === id,
        },
      },
    ]
  })
  const edges = workflow.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
  }))
  return { nodes, edges }
}

function FollowCurrentStage({ stageId }: { stageId: string | null }) {
  const flow = useReactFlow()
  const width = useStore((store) => store.width)
  const height = useStore((store) => store.height)
  useEffect(() => {
    // Docked tabs stay mounted while hidden and measure 0x0; fit once visible.
    if (!stageId || width === 0 || height === 0) return
    const timer = window.setTimeout(() => {
      void flow.fitView({
        nodes: [{ id: stageId }],
        maxZoom: 1,
        minZoom: 0.5,
        duration: 250,
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [flow, stageId, width, height])
  return null
}

/**
 * Full project-setup roadmap (decision 0005): same workflow state as the
 * Workflow panel. Choosing a stage focuses it and shows it in Properties
 * (decision 0028), like every other object; the page has no details pane.
 */
export function RoadmapPage() {
  const headingId = useId()
  const { workbench, appearance, showInspection } = useServices()
  const workflow = useWorkbenchSnapshot((snapshot) => snapshot.state.workflow)
  const selection = useWorkbenchSnapshot((snapshot) => snapshot.state.selection)
  const states = useStageStates()
  const selectedId =
    selection.entityType === 'stage' ? (selection.ids[0] ?? null) : null

  const { nodes, edges } = useMemo(
    () => layoutWorkflow(workflow, states, selectedId),
    [workflow, states, selectedId],
  )

  const choose = (stageId: string) => {
    workbench.execute({ type: 'workflow.setCurrentStage', input: { stageId } })
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'stage', ids: [stageId] },
    })
    showInspection()
  }

  return (
    <section className={styles.roadmap} aria-labelledby={headingId}>
      <PanelHeader
        className={styles.header}
        title="Roadmap"
        headingId={headingId}
        meta={<CapabilityBadge id="workflow.graph" />}
      />
      <div className={styles.body}>
        <div
          className={styles.canvas}
          role="region"
          aria-label="Workflow graph"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            // A click handler also keeps nodes reachable by the pointer:
            // without one, React Flow passes clicks to the pane underneath.
            onNodeClick={(_, node) => choose(node.id)}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            colorMode={appearance.scheme}
            minZoom={0.25}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
            <FollowCurrentStage stageId={workflow.currentStageId} />
          </ReactFlow>
        </div>
      </div>
    </section>
  )
}
