import { Eye } from 'lucide-react'
import type { StageState } from '../../domain/types.ts'
import type { HandoverProvenance } from '../../server/handover.ts'
import { formatCount, formatDateTime } from '../format.ts'
import { InlineAlert } from './InlineAlert.tsx'
import { PropertyList } from './PropertyList.tsx'
import { Section } from './Section.tsx'
import { StateBadge } from './StateBadge.tsx'
import styles from './handover.module.css'

/**
 * The viewer's mark (decision 0032, stage 5): the shell shows it beside the
 * package name so nobody mistakes the page for the modeller.
 */
export function ViewOnlyBadge() {
  return (
    <span
      className={styles.badge}
      title="A frozen handover package: the model cannot be changed here."
    >
      <Eye size={14} aria-hidden="true" />
      View only
    </span>
  )
}

const STATE_ORDER: StageState[] = [
  'executed',
  'stale',
  'failed',
  'skipped',
  'blocked',
  'ready',
  'future',
  'unavailable',
  'running',
]

const STATE_WORDS: Record<StageState, string> = {
  executed: 'complete',
  stale: 'outdated',
  failed: 'failed',
  skipped: 'skipped',
  blocked: 'blocked',
  ready: 'ready',
  future: 'not started',
  unavailable: 'planned',
  running: 'running',
}

/** "12 stages: 10 complete, 1 outdated, 1 skipped". */
export function describeStages(stages: HandoverProvenance['stages']): string {
  const counts = new Map<StageState, number>()
  for (const stage of stages)
    counts.set(stage.state, (counts.get(stage.state) ?? 0) + 1)
  const parts = STATE_ORDER.flatMap((state) => {
    const count = counts.get(state)
    return count ? [`${count} ${STATE_WORDS[state]}`] : []
  })
  return `${formatCount(stages.length, 'stage')}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`
}

const BY: Record<HandoverProvenance['handedOverBy'], string> = {
  manual: 'the modeller',
  agent: 'the agent, with approval',
  system: 'the system',
}

/**
 * What a handover package holds and where it came from (decision 0032,
 * stage 5): shown by the modeller after Hand over, by the viewer's package
 * list, and by the viewer's About this handover.
 */
export function HandoverSummary({
  createdAt,
  provenance,
  warnings,
  fileName = null,
  headingLevel = 3,
}: {
  createdAt: string
  provenance: HandoverProvenance
  warnings: string[]
  /** The file it was opened from, when it was. */
  fileName?: string | null
  headingLevel?: 3 | 4
}) {
  const { excluded } = provenance
  return (
    <div className={styles.summary}>
      {warnings.map((warning) => (
        <InlineAlert key={warning} tone="warning">
          {warning}
        </InlineAlert>
      ))}
      <PropertyList
        aria-label="Handover provenance"
        items={[
          { label: 'Project', value: provenance.projectName },
          { label: 'Handed over', value: formatDateTime(createdAt) },
          { label: 'By', value: BY[provenance.handedOverBy] },
          {
            label: 'Saved by the modeller',
            value: provenance.savedAt
              ? `${formatDateTime(provenance.savedAt)}${provenance.unsavedChanges ? '; later unsaved changes left out' : ''}`
              : 'Never saved in the modeller',
          },
          fileName ? { label: 'Opened from', value: fileName } : null,
          { label: 'Stages', value: describeStages(provenance.stages) },
          {
            label: 'Results',
            value:
              provenance.results.length > 0
                ? provenance.results
                    .map((result) => `${result.label} (run ${result.runId})`)
                    .join('; ')
                : 'None published',
          },
          {
            label: 'Left out',
            value: `${formatCount(excluded.heldOutputs, 'held job output')}, ${formatCount(excluded.jobLogLines, 'job log line')}, ${formatCount(excluded.drafts, 'unsent draft')}`,
          },
        ]}
      />
      <Section
        title="Stage states at handover"
        count={provenance.stages.length}
        level={headingLevel === 3 ? 4 : 3}
      >
        <ul className={styles.stages}>
          {provenance.stages.map((stage) => (
            <li key={stage.id}>
              <span>{stage.name}</span>
              <StateBadge state={stage.state} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
