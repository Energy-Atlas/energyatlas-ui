import { Button } from 'react-aria-components'
import type { ProjectSummary } from '../../server/projectCatalog.ts'
import { useServices } from '../WorkbenchContext.tsx'
import styles from './project.module.css'

export function ProjectList({
  projects,
  disabled = false,
}: {
  projects: ProjectSummary[]
  disabled?: boolean
}) {
  const { lifecycle } = useServices()
  return (
    <ul className={styles.projects}>
      {projects.map((project) => (
        <li key={project.id}>
          <Button
            className={styles.projectRow}
            isDisabled={disabled}
            onPress={() =>
              void lifecycle.request({ type: 'open', projectId: project.id })
            }
          >
            <span className={styles.projectName}>{project.name}</span>
            <span className={styles.metadata}>
              Saved {new Date(project.savedAt).toLocaleString()}
              {project.lastOpenedAt
                ? ` · Opened ${new Date(project.lastOpenedAt).toLocaleString()}`
                : ''}
            </span>
            <span className={styles.metadata}>
              This browser · Reference {project.id.slice(-8)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}
