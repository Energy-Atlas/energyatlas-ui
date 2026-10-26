import { groupOf } from '../../../domain/jobs/runGroups.ts'
import type { CommandSource } from '../../../domain/types.ts'
import type { ExecuteResult, Workbench } from '../../../domain/workbench.ts'
import type { ProjectClient } from '../../service/projectClient.ts'
import type { ViewStore } from '../../view/viewStore.ts'

type JobServices = {
  client: ProjectClient
  workbench: Workbench
  view: ViewStore
}

/** Retries a job's run and selects the new attempt once the server accepts it. */
export async function retryAndSelect(
  { client, workbench, view }: JobServices,
  taskId: string,
  source: CommandSource = 'manual',
): Promise<ExecuteResult> {
  const result = await client.execute(
    { type: 'job.retry', input: { taskId } },
    source,
  )
  if (result.outcome.status !== 'applied') return result
  const state = workbench.getState()
  const task = state.tasks[taskId]
  const latest = task ? groupOf(state, task)?.attemptIds.at(-1) : undefined
  if (latest && latest !== taskId) {
    view.execute({ type: 'jobs.select', input: { taskId: latest } }, source)
  }
  return result
}

/** Starts a fresh run of a job's stage and selects it once the server accepts it. */
export async function freshRunAndSelect(
  { client, workbench, view }: JobServices,
  stageId: string,
  source: CommandSource = 'manual',
): Promise<ExecuteResult> {
  const result = await client.execute(
    { type: 'workflow.runStage', input: { stageId } },
    source,
  )
  if (result.outcome.status !== 'applied') return result
  const state = workbench.getState()
  const latest = [...state.taskIds]
    .reverse()
    .find((id) => state.tasks[id]?.stageId === stageId)
  if (latest)
    view.execute({ type: 'jobs.select', input: { taskId: latest } }, source)
  return result
}
