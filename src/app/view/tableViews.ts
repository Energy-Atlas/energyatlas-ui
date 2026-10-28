// The Table page's views (decision 0032, stage 6 adds floors and zones). A
// module of its own, so saved layouts can validate a view without importing
// the view operations, which import them.

export type TableView = 'buildings' | 'floors' | 'zones' | 'grid'

export const TABLE_VIEWS = [
  'buildings',
  'floors',
  'zones',
  'grid',
] as const satisfies readonly TableView[]
