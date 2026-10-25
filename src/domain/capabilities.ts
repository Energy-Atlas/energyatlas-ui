// Single source of truth for what each feature honestly is in this prototype.
// UI labels read from here so a placeholder cannot pass as working behavior.

export type CapabilityStatus = 'working' | 'simulated' | 'planned'

export type Capability = {
  label: string
  status: CapabilityStatus
  explanation: string
}

export const capabilities = {
  'assets.tree': {
    label: 'Asset tree',
    status: 'working',
    explanation:
      'Browses the synthetic project; assets appear as workflow stages produce them.',
  },
  'workflow.graph': {
    label: 'Workflow graph',
    status: 'working',
    explanation:
      'Stage states, skipping, custom stages, and outdated-result propagation are real state transitions.',
  },
  'workflow.stageRuns': {
    label: 'Stage runs',
    status: 'simulated',
    explanation:
      'Runs are deterministic stand-ins that produce synthetic outputs; no engineering calculation is performed.',
  },
  'workflow.freeformEditing': {
    label: 'Free-form graph editing',
    status: 'planned',
    explanation:
      'Only inserting and skipping stages is available; arbitrary edge editing is planned.',
  },
  'table.pendingEdits': {
    label: 'Table edits',
    status: 'working',
    explanation:
      'Edits are validated, held as pending, and applied or discarded explicitly.',
  },
  'map.view': {
    label: 'Map',
    status: 'working',
    explanation:
      'Shows OpenStreetMap building footprints with synthetic attributes, and synthetic grid elements, with linked selection.',
  },
  'map.buildings3d': {
    label: '3D buildings',
    status: 'working',
    explanation:
      'Extrudes footprints to their synthetic heights (floors × 3.2 m) with tilt and rotation; selected buildings are outlined along their visible 3D silhouette.',
  },
  'map.lighting': {
    label: 'Map lighting',
    status: 'simulated',
    explanation:
      'The globe carries one solar state from the season and the UTC time, and each place takes its own sun from it, but the lighting is for display: it feeds no shading or PV result, and MapLibre casts no shadows.',
  },
  'map.terrain': {
    label: 'Terrain',
    status: 'working',
    explanation:
      'Relief and hillshade from live Mapterhorn elevation tiles (USGS 3DEP here), for display only; falls back to a flat map when unavailable.',
  },
  'map.basemap': {
    label: 'Basemap',
    status: 'working',
    explanation:
      'Streets, water, and labels from OpenFreeMap tiles over the network, recolored to the appearance; falls back to a plain background when unavailable.',
  },
  'map.geometryEditing': {
    label: 'Geometry editing',
    status: 'planned',
    explanation: 'Footprint and network geometry cannot be edited yet.',
  },
  'dashboard.comparison': {
    label: 'Scenario comparison',
    status: 'simulated',
    explanation: 'Comparison logic is real; every number is synthetic.',
  },
  'dashboard.customWidgets': {
    label: 'Custom widgets',
    status: 'planned',
    explanation: 'User-defined dashboard widgets are planned.',
  },
  'creator.measure': {
    label: 'Measure creator',
    status: 'working',
    explanation: 'Creates validated measures through the shared command layer.',
  },
  'creator.scenario': {
    label: 'Scenario creator',
    status: 'working',
    explanation:
      'Creates validated scenarios through the shared command layer.',
  },
  'creator.otherAssets': {
    label: 'Other creators',
    status: 'planned',
    explanation:
      'Creators for buildings, archetypes, grid elements, and views are planned.',
  },
  'grid.gasNetwork': {
    label: 'Gas network',
    status: 'planned',
    explanation: 'Gas network modeling is planned and has no data yet.',
  },
  'data.documentViewer': {
    label: 'Documents',
    status: 'planned',
    explanation:
      'Multimodal documents, references, and energy code viewing are planned.',
  },
  'data.userTableImport': {
    label: 'User tables',
    status: 'planned',
    explanation: 'Importing user tables is planned.',
  },
  'reports.export': {
    label: 'Report export',
    status: 'planned',
    explanation:
      'Report content is assembled from synthetic results; exporting is planned.',
  },
  'agent.sessions': {
    label: 'Agent sessions',
    status: 'simulated',
    explanation:
      'Scripted replays of realistic tool calls; no language model is called.',
  },
  'agent.documentGrounding': {
    label: 'Document grounding',
    status: 'planned',
    explanation: 'Grounding agent answers in project documents is planned.',
  },
  'agent.steering': {
    label: 'Steering a running session',
    status: 'simulated',
    explanation:
      'A scripted session cannot change course. A stirred message is recorded and answered when the session ends.',
  },
  'agent.attachments': {
    label: 'Attachments',
    status: 'planned',
    explanation:
      'Attaching documents, images, or selections to a message is planned.',
  },
  'agent.reasoningEffort': {
    label: 'Model and reasoning effort',
    status: 'planned',
    explanation:
      'Choosing a language model and its reasoning effort is planned; the first slice replays scripted sessions.',
  },
  'ribbon.comments': {
    label: 'Comments',
    status: 'planned',
    explanation: 'Commenting on assets and results is planned.',
  },
  'account.demo': {
    label: 'Account',
    status: 'simulated',
    explanation:
      'The initials in the ribbon belong to a fictional demo person; nobody is signed in.',
  },
  'account.settings': {
    label: 'Account settings',
    status: 'planned',
    explanation:
      'Viewing and editing your account is planned once real accounts exist.',
  },
  'account.signIn': {
    label: 'Signing in and out',
    status: 'planned',
    explanation:
      'Signing in is planned; this demo has no account to log out of.',
  },
  'status.compute': {
    label: 'Computing resources',
    status: 'simulated',
    explanation: 'Resource figures are illustrative, not measured.',
  },
  'layout.saveAsView': {
    label: 'Saved layouts',
    status: 'planned',
    explanation: 'Saving a workbench layout as a View asset is planned.',
  },
  'settings.modelProvider': {
    label: 'Model provider',
    status: 'planned',
    explanation:
      'Connecting a real model provider is planned; the first slice uses scripted sessions.',
  },
} as const satisfies Record<string, Capability>

export type CapabilityId = keyof typeof capabilities

export function getCapability(id: CapabilityId): Capability {
  return capabilities[id]
}
