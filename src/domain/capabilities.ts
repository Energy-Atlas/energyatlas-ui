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
  'intake.fusion': {
    label: 'Data intake and fusion',
    status: 'simulated',
    explanation:
      'Mapping, validation, stable-ID matching, and fusion jobs are real state transitions over synthetic datasets; files are not uploaded or parsed.',
  },
  'schema.mapping': {
    label: 'Schema matching',
    status: 'simulated',
    explanation:
      'Suggestions, review, validation, value maps, rule sets, and applying the mapping as a job are real state transitions over synthetic OpenStreetMap-like footprint tags; units are not converted and transforms are not supported, as in RC.',
  },
  'intake.upload': {
    label: 'File upload',
    status: 'planned',
    explanation:
      'Choosing a file from disk or a server is deferred; choose a synthetic dataset instead.',
  },
  'archetypes.library': {
    label: 'Archetypes and assignment',
    status: 'simulated',
    explanation:
      'Archetype parts, archetypes, assignment rules with per-part first match, manual parts, the preview, validation, and assignment jobs are real state transitions; the library values and the demand formula from parts are synthetic.',
  },
  'archetypes.schedules': {
    label: 'Schedules',
    status: 'simulated',
    explanation:
      'Daily and weekly schedules are validated and kept with space-loads parts; their full-load hours scale the synthetic lighting, equipment, and occupant loads.',
  },
  'calibration.fit': {
    label: 'Calibration',
    status: 'simulated',
    explanation:
      'Meter validation, fit jobs, residual metrics, calibrated variants, and explicit adoption are real state transitions; meter data is synthetic and the fit is one whole-district factor, not a real calibration algorithm.',
  },
  'results.drilldown': {
    label: 'Results drill-down',
    status: 'simulated',
    explanation:
      'Per-building and per-scenario results with provenance and currentness come from published synthetic results; monthly and typical-weekday series are derived, not simulated hour by hour.',
  },
  'results.csv': {
    label: 'CSV export',
    status: 'working',
    explanation:
      'Exports a published result as CSV in the browser, naming its run and currentness; a native report generator is planned.',
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
  'map.layers': {
    label: 'Map layers',
    status: 'working',
    explanation:
      "A stack of layers over the project's buildings and grid, shown, hidden, reordered, and styled one by one, and saved with the project.",
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
      'Creators for buildings, grid elements, and views are planned. Archetypes and schedules are edited on the Archetypes page.',
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
      'The account belongs to a fictional demo person; nobody is signed in.',
  },
  'account.signIn': {
    label: 'Signing in and out',
    status: 'planned',
    explanation:
      'Signing in is planned; this demo has no account to log out of.',
  },
  'service.mockServer': {
    label: 'Server',
    status: 'simulated',
    explanation:
      'The project lives on a mock server inside this page, reached through a simulated connection with delay and demo faults; it restarts with each page load and restores the saved project.',
  },
  'status.compute': {
    label: 'Computing resources',
    status: 'simulated',
    explanation: 'Resource figures are illustrative, not measured.',
  },
  'layout.saveAsView': {
    label: 'Saved layouts',
    status: 'working',
    explanation:
      'Project layouts are saved with the project and shown here as View assets; personal layouts stay in this browser for every project.',
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
