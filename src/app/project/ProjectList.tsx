import type { ProjectSummary } from '../../server/projectCatalog.ts'
import { useServices } from '../WorkbenchContext.tsx'
import { SelectableList } from '../components/SelectableList.tsx'
import { formatDateTime } from '../format.ts'
import styles from './project.module.css'

/** Lists longer than this get a search field. */
const SEARCH_FROM = 6

/** Saved projects; choosing one (click or Enter) opens it. */
export function ProjectList({
  projects,
  disabled = false,
}: {
  projects: ProjectSummary[]
  disabled?: boolean
}) {
  const { lifecycle } = useServices()
  return (
    <SelectableList
      aria-label="Saved projects"
      className={styles.projects}
      selectionMode="none"
      items={projects.map((project) => {
        const meta = [
          `Saved ${formatDateTime(project.savedAt)}`,
          project.lastOpenedAt
            ? `Opened ${formatDateTime(project.lastOpenedAt)}`
            : null,
          `This browser · Reference ${project.id.slice(-8)}`,
        ]
          .filter(Boolean)
          .join(' · ')
        return { id: project.id, title: project.name, meta, description: meta }
      })}
      onAction={(projectId) =>
        void lifecycle.request({ type: 'open', projectId })
      }
      disabledReason={
        disabled ? 'Wait for the current project change to finish.' : null
      }
      search={
        projects.length >= SEARCH_FROM
          ? { label: 'Search saved projects', placeholder: 'Search projects' }
          : undefined
      }
    />
  )
}
