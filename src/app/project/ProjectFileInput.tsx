import { MAX_PROJECT_FILE_BYTES } from '../../server/projectFile.ts'
import { useServices } from '../WorkbenchContext.tsx'
import { PROJECT_FILE_INPUT_ID } from './projectFileChooser.ts'

/**
 * The hidden file input behind File > Open project file… (decision 0036).
 * A chosen file opens through the lifecycle, so leaving the open project
 * asks first, as every open does.
 */
export function ProjectFileInput() {
  const { lifecycle, workbench } = useServices()
  const refuse = (message: string) =>
    workbench.record({
      type: 'project.openFile',
      title: 'Open project file',
      status: 'rejected',
      summary: '',
      issues: [{ path: 'file', message }],
    })
  return (
    <input
      id={PROJECT_FILE_INPUT_ID}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      tabIndex={-1}
      aria-label="Project file"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        // Choosing the same file again must fire again.
        event.currentTarget.value = ''
        if (!file) return
        // Refused before reading, so a huge file is never loaded into memory.
        if (file.size > MAX_PROJECT_FILE_BYTES) {
          refuse(
            `"${file.name}" is larger than ${MAX_PROJECT_FILE_BYTES / 1024 / 1024} MB, too large for a project file.`,
          )
          return
        }
        void file.text().then(
          (text) =>
            void lifecycle.request({
              type: 'openFile',
              file: { name: file.name, text },
            }),
          () => refuse(`"${file.name}" could not be read from disk.`),
        )
      }}
    />
  )
}
