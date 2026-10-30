// The browser's file chooser for project files (decision 0036): File > Open
// project file… and the start screen's button both press this hidden input,
// which `ProjectFileInput` renders once beside the workbench.

export const PROJECT_FILE_INPUT_ID = 'project-file-input'

/** Opens the browser's file chooser for a project file. */
export function pickProjectFile(): void {
  document.getElementById(PROJECT_FILE_INPUT_ID)?.click()
}
