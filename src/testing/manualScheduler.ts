import type { Scheduler } from '../domain/simulator.ts'

/** A scheduler for tests: callbacks run only when the test steps it. */
export function manualScheduler() {
  const queue: { callback: () => void; cancelled: boolean }[] = []
  const scheduler: Scheduler = {
    schedule(callback) {
      const job = { callback, cancelled: false }
      queue.push(job)
      return () => {
        job.cancelled = true
      }
    },
  }
  const runNext = () => {
    const job = queue.shift()
    if (job && !job.cancelled) job.callback()
  }
  const runAll = (limit = 100) => {
    for (let count = 0; queue.length > 0 && count < limit; count++) runNext()
  }
  const pending = () => queue.filter((job) => !job.cancelled).length
  /** Lets promise continuations run, as the event loop would between timers. */
  const flush = async () => {
    for (let hop = 0; hop < 25; hop++) await Promise.resolve()
  }
  /** Like runAll, but for code that awaits between scheduled steps. */
  const settle = async (limit = 100) => {
    await flush()
    for (let count = 0; queue.length > 0 && count < limit; count++) {
      runNext()
      await flush()
    }
  }
  return { scheduler, runNext, runAll, pending, flush, settle }
}
