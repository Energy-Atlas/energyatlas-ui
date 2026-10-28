import { useMemo } from 'react'
import type { ResultSet } from '../../../domain/types.ts'
import {
  ZONE_KIND_LABELS,
  buildingZoning,
  demandShares,
  describeZoning,
} from '../../../domain/zoning/zoning.ts'
import { useServices, useWorkbenchSnapshot } from '../../WorkbenchContext.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import { Section } from '../../components/Section.tsx'
import { WorkbenchTable } from '../../components/WorkbenchTable.tsx'
import componentStyles from '../../components/components.module.css'
import type { DataColumn } from '../../tables/tableModel.ts'

// A drilled-down building's result split over its floors and zones by
// floor-area share (decision 0032, stage 6). Synthetic and labelled so; the
// building total and the published result are unchanged.

type Row = {
  id: string
  name: string
  kind: string
  floor: number | null
  areaM2: number
  sharePercent: number
  kwh: number
}

const COLUMNS: DataColumn<Row>[] = [
  { id: 'name', header: 'Zone', value: (row) => row.name, rowHeader: true },
  { id: 'kind', header: 'Type', value: (row) => row.kind, type: 'enum' },
  {
    id: 'floor',
    header: 'Floor',
    value: (row) => row.floor,
    type: 'number',
    empty: 'All',
  },
  {
    id: 'areaM2',
    header: 'Area',
    unit: 'm²',
    value: (row) => row.areaM2,
    type: 'number',
  },
  {
    id: 'sharePercent',
    header: 'Share',
    unit: '%',
    value: (row) => row.sharePercent,
    type: 'number',
    decimals: 1,
  },
  {
    id: 'kwh',
    header: 'Demand',
    unit: 'kWh/yr',
    value: (row) => row.kwh,
    type: 'number',
  },
]

export function ZoneBreakdown({
  result,
  label,
  buildingId,
}: {
  result: ResultSet
  label: string
  buildingId: string
}) {
  const { workbench } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const zoning = buildingZoning(state, buildingId)
  const kwh = result.byBuildingKwh[buildingId]
  const rows = useMemo<Row[]>(() => {
    if (!zoning || kwh === undefined) return []
    const shares = demandShares(zoning, kwh)
    return zoning.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      kind: ZONE_KIND_LABELS[zone.kind],
      floor: zone.floor,
      areaM2: zone.areaM2,
      sharePercent: kwh > 0 ? ((shares.zones[zone.id] ?? 0) / kwh) * 100 : 0,
      // Whole kWh by largest remainders: the rows add up to the total.
      kwh: shares.zones[zone.id] ?? 0,
    }))
  }, [zoning, kwh])
  const name = state.buildings[buildingId]?.name ?? buildingId
  const selected =
    state.selection.entityType === 'zone'
      ? (state.selection.ids[0] ?? null)
      : null
  return (
    <Section
      title={`Show ${name} by zone (synthetic split)`}
      id="results.zones"
      level={4}
      count={rows.length}
    >
      {zoning ? (
        <>
          <p className={componentStyles.muted}>
            {label} for {name} split over its {zoning.zones.length} zones (
            {describeZoning({
              mode: zoning.appliedMode,
              perimeterDepthM: zoning.setting.perimeterDepthM,
            }).toLowerCase()}
            ) by floor-area share: the rows add up to the building&rsquo;s
            published total in whole kWh, and no zone is simulated on its own.{' '}
            <CapabilityBadge id="results.zoneBreakdown" />
          </p>
          <WorkbenchTable
            id="results.zones"
            aria-label={`${label} of ${name} by zone`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            pageSize={50}
            selection={{
              selectedKey: selected,
              onSelect: (id) =>
                workbench.execute({
                  type: 'selection.set',
                  input: { entityType: 'zone', ids: [id] },
                }),
            }}
            exportContext={[
              `result: ${label}, run ${result.runId}`,
              `building: ${buildingId}`,
              'split by floor-area share (synthetic)',
            ]}
          />
        </>
      ) : (
        <p className={componentStyles.muted}>
          {name} has no zones yet: they appear once Geospatial preprocessing has
          zoned it by the zoning setting.
        </p>
      )}
    </Section>
  )
}
