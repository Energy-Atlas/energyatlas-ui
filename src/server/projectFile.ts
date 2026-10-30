import { z } from 'zod'
import type { WorkbenchState } from '../domain/types.ts'
import type { CatalogEntry, SavedView } from './projectCatalog.ts'
import { parseSavedView } from './projectCatalog.ts'
import { projectStateSchema } from './projectSchema.ts'

// A project file (decision 0036, File > Save as… > Project): a fully editable
// copy of a project, as the browser's project catalog keeps it, wrapped so a
// file names what it is. Opening one adds it to this browser's projects.

export const PROJECT_FILE_FORMAT = 'energyatlas-ui.project'
export const PROJECT_FILE_VERSION = 1
/** Refused before reading, as view files are. */
export const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024

export type ProjectFile = {
  format: typeof PROJECT_FILE_FORMAT
  version: typeof PROJECT_FILE_VERSION
  savedAt: string
  project: {
    id: string
    name: string
    state: WorkbenchState
    view?: SavedView
  }
}

export function buildProjectFile(entry: CatalogEntry): ProjectFile {
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    savedAt: entry.savedAt,
    project: {
      id: entry.id,
      name: entry.name,
      state: entry.state,
      ...(entry.view ? { view: entry.view } : {}),
    },
  }
}

export type ProjectFileRead =
  { ok: true; file: ProjectFile } | { ok: false; message: string }

const fileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(PROJECT_FILE_VERSION),
  savedAt: z.string().min(1),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    state: projectStateSchema,
    view: z.unknown().optional(),
  }),
})

/** A project file from its text, validated and migrated like a saved project. */
export function readProjectFile(text: string): ProjectFileRead {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      ok: false,
      message:
        'This file could not be read as a project: it is not valid JSON. It may be truncated or not a project file.',
    }
  }
  const format = (value as { format?: unknown } | null)?.format
  if (format !== PROJECT_FILE_FORMAT) {
    return {
      ok: false,
      message:
        format === 'energyatlas-ui.handover'
          ? 'This file is a view, which opens on the viewer page. Choose a project file saved with File > Save as… > Project.'
          : 'This file is not an EnergyAtlas project. Choose a project file saved with File > Save as… > Project.',
    }
  }
  const version = (value as { version?: unknown }).version
  if (typeof version === 'number' && version > PROJECT_FILE_VERSION) {
    return {
      ok: false,
      message: `This project file was made by a newer version of EnergyAtlas (format ${version}); this version reads format ${PROJECT_FILE_VERSION}.`,
    }
  }
  const parsed = fileSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : ''
    return {
      ok: false,
      message: `This project file is damaged or incomplete${where}: ${issue?.message ?? 'it does not match the project format.'}`,
    }
  }
  const { project } = parsed.data
  if (
    project.state.project.id !== project.id ||
    project.state.project.name !== project.name
  ) {
    return {
      ok: false,
      message:
        'This project file is damaged or incomplete: its name or id does not match the project inside.',
    }
  }
  const view = parseSavedView(project.view)
  return {
    ok: true,
    file: {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      savedAt: parsed.data.savedAt,
      project: {
        id: project.id,
        name: project.name,
        state: project.state,
        ...(view ? { view } : {}),
      },
    },
  }
}

/** "back-bay-study-2026-10-29.project.json". */
export function projectFileName(name: string, savedAt: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  return `${slug}-${savedAt.slice(0, 10)}.project.json`
}
