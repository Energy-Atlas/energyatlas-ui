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
import { useEffect, useId, useMemo, useState } from 'react'
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from 'react-aria-components'
import type { StageState, WorkflowState } from '../../domain/types.ts'
import {
  downstreamIds,
  hasActiveTask,
  stageRunBlocker,
  upstreamIds,
} from '../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import { forStage, waitingReason } from '../service/usePendingReason.ts'
import styles from './roadmap.module.css'

const NODE_WIDTH = 210
const NODE_HEIGHT = 76

type StageNodeData = {
  stageId: string
  number: number
  name: string
  state: StageState
  isCurrent: boolean
  onFocusStage: (stageId: string) => void
}

type StageFlowNode = Node<StageNodeData, 'stage'>

// Each node is a real button so stages are reachable with Tab; React Flow's
// own node focus is off to avoid a second, non-activating tab stop.
function StageNode({ data }: NodeProps<StageFlowNode>) {
  return (
    <div className={cx(styles.node, data.isCurrent && styles.nodeCurrent)}>
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
        onClick={() => data.onFocusStage(data.stageId)}
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
  onFocusStage: (stageId: string) => void,
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
          onFocusStage,
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

/** Full project-setup roadmap (decision 0005): same workflow state as the Workflow panel. */
export function RoadmapPage() {
  const headingId = useId()
  const { workbench, appearance } = useServices()
  const workflow = useWorkbenchSnapshot((snapshot) => snapshot.state.workflow)
  const states = useStageStates()

  const { nodes, edges } = useMemo(
    () =>
      layoutWorkflow(workflow, states, (stageId) =>
        workbench.execute({
          type: 'workflow.setCurrentStage',
          input: { stageId },
        }),
      ),
    [workflow, states, workbench],
  )

  return (
    <section className={styles.roadmap} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h2 id={headingId}>Roadmap</h2>
        <CapabilityBadge id="workflow.graph" />
      </header>
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
        <StageDetails />
      </div>
    </section>
  )
}

function StageDetails() {
  const { workbench, client } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const workflow = useWorkbenchSnapshot((snapshot) => snapshot.state.workflow)
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
  const states = useStageStates()
  const stageId = workflow.currentStageId
  const stage = stageId ? workflow.stages[stageId] : undefined

  if (!stageId || !stage) {
    return (
      <aside className={styles.details} aria-label="Stage details">
        <p className={componentStyles.empty}>
          Select a stage to see its details.
        </p>
      </aside>
    )
  }

  const index = workflow.stageIds.indexOf(stageId)
  const previousId = workflow.stageIds[index - 1]
  const nextId = workflow.stageIds[index + 1]
  const names = (ids: string[]) =>
    ids.map((id) => workflow.stages[id]?.name ?? id).join(', ') || 'None'
  const hasRun = stage.lastRun !== null
  const focus = (id: string) =>
    workbench.execute({
      type: 'workflow.setCurrentStage',
      input: { stageId: id },
    })

  return (
    <aside className={styles.details} aria-label="Stage details">
      <div>
        <p className={styles.eyebrow}>Stage {index + 1}</p>
        <h3 className={styles.stageName}>{stage.name}</h3>
        <StateBadge state={states[stageId] ?? 'future'} />
      </div>
      <p className={componentStyles.muted}>{stage.description}</p>
      <dl className={styles.facts}>
        <dt>Depends on</dt>
        <dd>{names(upstreamIds(workflow, stageId))}</dd>
        <dt>Feeds</dt>
        <dd>{names(downstreamIds(workflow, stageId))}</dd>
        <dt>Last run</dt>
        <dd>{stage.lastRun?.message ?? 'Not run yet.'}</dd>
      </dl>
      <div className={styles.actions}>
        <ActionButton
          label={`${hasRun ? 'Rerun' : 'Run'} ${stage.name}`}
          variant="primary"
          disabledReason={
            waitingReason(
              pending,
              'workflow.runStage',
              'the run was requested',
              forStage(stageId),
            ) ?? stageRunBlocker(workflow, tasks, stageId)
          }
          onPress={() =>
            void client.execute({
              type: 'workflow.runStage',
              input: { stageId },
            })
          }
        >
          {hasRun ? 'Rerun' : 'Run'}
        </ActionButton>
        {stage.skippable ? (
          <ActionButton
            label={`${stage.skipped ? 'Restore' : 'Skip'} ${stage.name}`}
            disabledReason={
              hasActiveTask(tasks, stageId)
                ? `"${stage.name}" is running.`
                : waitingReason(
                    pending,
                    'workflow.setStageSkipped',
                    stage.skipped
                      ? 'the stage is being restored'
                      : 'the stage is being skipped',
                    forStage(stageId),
                  )
            }
            onPress={() =>
              void client.execute({
                type: 'workflow.setStageSkipped',
                input: { stageId, skipped: !stage.skipped },
              })
            }
          >
            {stage.skipped ? 'Restore' : 'Skip'}
          </ActionButton>
        ) : null}
      </div>
      <div className={styles.actions}>
        <ActionButton
          label="Previous stage"
          disabledReason={previousId ? null : 'This is the first stage.'}
          onPress={() => {
            if (previousId) focus(previousId)
          }}
        >
          Previous
        </ActionButton>
        <ActionButton
          label="Next stage"
          disabledReason={nextId ? null : 'This is the last stage.'}
          onPress={() => {
            if (nextId) focus(nextId)
          }}
        >
          Next
        </ActionButton>
      </div>
      <InsertStageForm afterStageId={stageId} key={stageId} />
    </aside>
  )
}

function InsertStageForm({ afterStageId }: { afterStageId: string }) {
  const { client } = useServices()
  const [sending, setSending] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [general, setGeneral] = useState<string | null>(null)

  return (
    <Form
      className={styles.insertForm}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        if (sending) return
        setSending(true)
        void client
          .execute({
            type: 'workflow.insertStage',
            input: { afterStageId, name },
          })
          .then((result) => {
            setSending(false)
            if (result.outcome.status === 'applied') {
              setName('')
              setNameError(null)
              setGeneral(null)
              return
            }
            const split = splitIssues(result.outcome.issues)
            setNameError(split.fieldErrors.name ?? null)
            setGeneral(
              [split.general, split.fieldErrors.afterStageId]
                .filter(Boolean)
                .join(' ') || null,
            )
          })
      }}
    >
      <TextField
        name="name"
        className={formStyles.field}
        value={name}
        isInvalid={nameError !== null}
        onChange={(value) => {
          setName(value)
          setNameError(null)
        }}
      >
        <Label className={formStyles.label}>
          Insert a custom stage after this one
        </Label>
        <Input className={formStyles.input} />
        <FieldError className={formStyles.fieldError}>{nameError}</FieldError>
      </TextField>
      {general ? (
        <p className={formStyles.alert} role="alert">
          {general}
        </p>
      ) : null}
      <Button
        type="submit"
        className={componentStyles.button}
        isPending={sending}
      >
        {sending ? 'Sending…' : 'Insert stage'}
      </Button>
    </Form>
  )
}
