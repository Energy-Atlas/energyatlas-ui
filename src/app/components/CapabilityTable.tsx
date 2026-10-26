import {
  capabilities,
  type Capability,
  type CapabilityId,
} from '../../domain/capabilities.ts'
import type { DataColumn } from '../tables/tableModel.ts'
import { StatusTag } from './CapabilityBadge.tsx'
import { WorkbenchTable } from './WorkbenchTable.tsx'

const STATUS_LABELS = {
  working: 'Working',
  simulated: 'Simulated',
  planned: 'Planned',
} satisfies Record<Capability['status'], string>

type CapabilityRow = Capability & { id: CapabilityId }

const COLUMNS: DataColumn<CapabilityRow>[] = [
  {
    id: 'feature',
    header: 'Feature',
    value: (capability) => capability.label,
    rowHeader: true,
    width: 220,
  },
  {
    id: 'status',
    header: 'Status',
    value: (capability) => STATUS_LABELS[capability.status],
    type: 'enum',
    width: 130,
    render: (capability) => <StatusTag status={capability.status} />,
  },
  {
    id: 'explanation',
    header: 'Explanation',
    value: (capability) => capability.explanation,
    wrap: true,
  },
]

/** What each feature is in this prototype: working, simulated, or planned. */
export function CapabilityTable() {
  return (
    <WorkbenchTable
      id="settings.capabilities"
      aria-label="What each feature is in this prototype"
      columns={COLUMNS}
      rows={(Object.keys(capabilities) as CapabilityId[]).map((id) => ({
        id,
        ...capabilities[id],
      }))}
      rowKey={(capability) => capability.id}
    />
  )
}
