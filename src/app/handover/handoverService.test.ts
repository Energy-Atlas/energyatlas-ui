import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../testing/memoryStorage.ts'
import { createTestProject } from '../../testing/testProject.ts'
import { createHandoverService } from './handoverService.ts'

// The shared Hand over service (decision 0032, stage 5): it can hand over
// again after a handover, and a failed request never leaves it busy.

async function savedProject() {
  const project = createTestProject({
    storage: memoryStorage(),
    fixture: 'complete',
  })
  // A handover packages the saved copy.
  const saved = project.client.save()
  await project.manual.settle()
  await saved
  return project
}

describe('the hand over service', () => {
  it('hands over again once a handover has finished', async () => {
    const { client, workbench, manual } = await savedProject()
    const handover = createHandoverService({ client, workbench })
    expect(handover.blocker()).toBeNull()
    for (let round = 0; round < 2; round += 1) {
      const running = handover.handOver()
      expect(handover.store.getState().busy).toBe(true)
      expect(handover.blocker()).toBe('A view is already being saved.')
      await manual.settle()
      const result = await running
      expect(result.busy).toBe(false)
      expect(result.last?.package.id).toMatch(/^handover:/)
      expect(handover.blocker()).toBeNull()
    }
  })

  it('is not left busy when the request fails', async () => {
    const { client, workbench } = await savedProject()
    const handover = createHandoverService({
      client: {
        ...client,
        handOver: () => Promise.reject(new Error('The connection dropped.')),
      },
      workbench,
    })
    await expect(handover.handOver()).rejects.toThrow('The connection dropped.')
    expect(handover.store.getState().busy).toBe(false)
    expect(handover.blocker()).toBeNull()
  })
})
