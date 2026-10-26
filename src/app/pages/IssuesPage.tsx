import { CircleX, Info, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import type { Issue, IssueSeverity } from '../../domain/types.ts'
import { useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import styles from '../components/components.module.css'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import type { DataColumn } from '../tables/tableModel.ts'

const SEVERITY = {
  error: { label: 'Error', icon: CircleX },
  warning: { label: 'Warning', icon: TriangleAlert },
  info: { label: 'Info', icon: Info },
} satisfies Record<IssueSeverity, unknown>

const ORDER: IssueSeverity[] = ['error', 'warning', 'info']

export function IssuesPage() {
  const headingId = useId()
  const issues = useWorkbenchSnapshot((snapshot) => snapshot.state.issues)
  const stages = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.workflow.stages,
  )
  const sorted = [...issues].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  )
  const columns: DataColumn<Issue>[] = [
    {
      id: 'severity',
      header: 'Severity',
      value: (issue) => SEVERITY[issue.severity].label,
      type: 'enum',
      width: 120,
      render: (issue) => {
        const meta = SEVERITY[issue.severity]
        const Icon = meta.icon
        return (
          <>
            <Icon size={14} aria-hidden="true" /> {meta.label}
          </>
        )
      },
    },
    {
      id: 'message',
      header: 'Message',
      wrap: true,
      value: (issue) => issue.message,
      rowHeader: true,
    },
    {
      id: 'stage',
      header: 'Stage',
      value: (issue) =>
        issue.stageId ? (stages[issue.stageId]?.name ?? issue.stageId) : null,
      type: 'enum',
    },
  ]

  return (
    <section className={styles.page} aria-labelledby={headingId}>
      <PanelHeader title="Issues" headingId={headingId} />
      {sorted.length === 0 ? (
        <p className={styles.empty}>
          No issues. Stage runs report warnings and errors here.
        </p>
      ) : (
        <WorkbenchTable
          id="issues"
          aria-label="Issues"
          columns={columns}
          rows={sorted}
          rowKey={(issue) => issue.id}
        />
      )}
    </section>
  )
}
