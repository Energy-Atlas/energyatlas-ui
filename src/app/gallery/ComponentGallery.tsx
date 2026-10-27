import {
  Columns3,
  Download,
  Filter,
  Paintbrush,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { StageState } from '../../domain/types.ts'
import {
  APPEARANCE_LIST,
  isAppearanceId,
  resolveAppearance,
  type AppearanceId,
} from '../appearance/appearances.ts'
import { StatusTag } from '../components/CapabilityBadge.tsx'
import componentStyles from '../components/components.module.css'
import { DataTable } from '../components/DataTable.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { MenuButton } from '../components/MenuButton.tsx'
import type { Message } from '../messages/messageCenter.ts'
import { MessageRow } from '../panels/MessagesPanel.tsx'
import messageStyles from '../panels/messages.module.css'
import { Toast } from '../shell/ToastHost.tsx'
import { HeaderCount, PanelHeader } from '../components/PanelHeader.tsx'
import { PropertyList } from '../components/PropertyList.tsx'
import { Section } from '../components/Section.tsx'
import { SegmentedFilter } from '../components/SegmentedFilter.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { Toolbar, type ToolbarItem } from '../components/Toolbar.tsx'
import { cx } from '../cx.ts'
import type { DataColumn } from '../tables/tableModel.ts'
import {
  applyTableChange,
  defaultTableSettings,
} from '../tables/tableSettings.ts'
import {
  formatCount,
  formatDateTime,
  formatEnergy,
  formatNumber,
} from '../format.ts'
import '../global.css'
import { getBrowserStorage } from '../storage.ts'
import { applyAppearance, readAppearancePreference } from '../theme.ts'
import styles from './gallery.module.css'

const STATES: StageState[] = [
  'future',
  'ready',
  'running',
  'executed',
  'skipped',
  'blocked',
  'failed',
  'stale',
  'unavailable',
]

const SAMPLE_AT = new Date(Date.UTC(2026, 9, 26, 14, 5)).toISOString()

function sampleMessage(
  id: string,
  fields: Pick<Message, 'tone' | 'source' | 'text'> & Partial<Message>,
): Message {
  return {
    id,
    at: SAMPLE_AT,
    actor: 'manual',
    projectId: 'project:gallery',
    operationId: null,
    actions: [],
    toast: true,
    read: false,
    resolved: false,
    ...fields,
  }
}

const SAMPLE_MESSAGES: Message[] = [
  sampleMessage('job', {
    tone: 'success',
    source: 'job',
    text: 'Geospatial preprocessing completed.',
    actions: [{ kind: 'openJob', label: 'Open job', taskId: 'task-1' }],
  }),
  sampleMessage('partial', {
    tone: 'warning',
    source: 'job',
    text: 'Geospatial preprocessing partly failed: 12 of 464 items failed; successful results are held.',
    actions: [{ kind: 'openJob', label: 'Open job', taskId: 'task-2' }],
  }),
  sampleMessage('server', {
    tone: 'danger',
    source: 'server',
    projectId: null,
    text: 'Not sent: the server cannot be reached (demo condition: offline).',
  }),
  sampleMessage('applied', {
    tone: 'info',
    source: 'project',
    toast: false,
    read: true,
    operationId: 'op-1',
    text: 'Created the measure "Roof insulation".',
  }),
  sampleMessage('approval', {
    tone: 'warning',
    source: 'agent',
    actor: 'agent',
    resolved: true,
    read: true,
    text: 'The agent is waiting for your approval: Run Shading.',
    actions: [
      { kind: 'openPanel', label: 'Open Reasoning', panel: 'reasoning' },
    ],
  }),
]

function initialAppearance(): AppearanceId {
  const requested = new URLSearchParams(window.location.search).get(
    'appearance',
  )
  if (requested && isAppearanceId(requested)) return requested
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return resolveAppearance(
    readAppearancePreference(getBrowserStorage()),
    systemDark,
  ).id
}

type JobFilter = 'all' | 'active' | 'attention'

type GalleryBuilding = {
  id: string
  name: string
  use: string
  floors: number | null
  demandKwh: number
  peakKw: number
}

const USES = ['Office', 'Residential', 'Retail', 'Mixed use']

// Synthetic rows, generated so every reader sees the same table.
const BUILDINGS: GalleryBuilding[] = Array.from({ length: 40 }, (_, index) => {
  const floors = index % 9 === 4 ? null : 2 + ((index * 7) % 11)
  return {
    id: `B${String(index + 1).padStart(4, '0')}`,
    name: `Building ${index + 1}`,
    use: USES[index % USES.length] ?? 'Office',
    floors,
    demandKwh: 80_000 + ((index * 37_919) % 900_000),
    peakKw: 40 + ((index * 53) % 400) + (index % 3) * 0.25,
  }
})

const BUILDING_COLUMNS: DataColumn<GalleryBuilding>[] = [
  {
    id: 'id',
    header: 'Building',
    value: (row) => row.id,
    type: 'identifier',
    rowHeader: true,
    width: 110,
  },
  { id: 'name', header: 'Name', value: (row) => row.name },
  { id: 'use', header: 'Use', value: (row) => row.use, type: 'enum' },
  {
    id: 'floors',
    header: 'Floors',
    value: (row) => row.floors,
    type: 'number',
    empty: 'No data',
  },
  {
    id: 'demand',
    header: 'Annual demand',
    value: (row) => row.demandKwh,
    type: 'number',
    unit: 'kWh',
  },
  {
    id: 'peak',
    header: 'Peak load',
    value: (row) => row.peakKw,
    type: 'number',
    unit: 'kW',
    decimals: 2,
  },
]

/**
 * Every shared panel component in its states (decision 0027), at
 * `/?gallery`. It doubles as the living guideline: browser tests check it in
 * every appearance, and a new component is added here with its states.
 */
export default function ComponentGallery() {
  const [appearance, setAppearance] = useState<AppearanceId>(initialAppearance)
  const [last, setLast] = useState('Nothing pressed yet.')
  const [filter, setFilter] = useState<JobFilter>('all')
  const [resolution, setResolution] = useState<'monthly' | 'hourly'>('monthly')
  const [shaded, setShaded] = useState(false)
  const [columns, setColumns] = useState(new Set(['id', 'name', 'demand']))
  const [tableSettings, setTableSettings] = useState(defaultTableSettings)

  useEffect(() => {
    const found = APPEARANCE_LIST.find((item) => item.id === appearance)
    if (found) applyAppearance(found)
  }, [appearance])

  const note = (text: string) => setLast(text)
  const blocked = (item: { label: string }, reason: string) =>
    note(`${item.label} is unavailable: ${reason}`)

  const tableTools: ToolbarItem[] = [
    {
      id: 'columns',
      label: 'Columns',
      icon: Columns3,
      onPress: () => note('Columns pressed.'),
      group: 'view',
    },
    {
      id: 'filter',
      label: 'Filter',
      icon: Filter,
      onPress: () => note('Filter pressed.'),
      group: 'view',
    },
    {
      id: 'shade',
      label: 'Shade rows',
      icon: Paintbrush,
      pressed: shaded,
      onPress: () => {
        setShaded((value) => !value)
        note(shaded ? 'Shaded rows off.' : 'Shaded rows on.')
      },
      group: 'view',
    },
    {
      id: 'download',
      label: 'Download CSV',
      icon: Download,
      onPress: () => note('Download pressed.'),
      group: 'data',
    },
    {
      id: 'refresh',
      label: 'Refresh',
      icon: RefreshCw,
      disabledReason: 'Results are current; nothing to refresh.',
      onPress: () => note('Refresh pressed.'),
      group: 'data',
    },
    {
      id: 'run',
      label: 'Run stage',
      icon: Play,
      primary: true,
      onPress: () => note('Run stage pressed.'),
      group: 'run',
    },
  ]

  return (
    <main className={styles.page} aria-labelledby="gallery-title">
      <PanelHeader
        title={<span id="gallery-title">Component gallery</span>}
        meta={<HeaderCount>decision 0027</HeaderCount>}
        actions={
          <SegmentedFilter
            aria-label="Appearance"
            segments={APPEARANCE_LIST.map((item) => ({
              id: item.id,
              label: item.label,
            }))}
            value={appearance}
            onChange={setAppearance}
          />
        }
      />
      <p className={styles.intro}>
        Shared panel components in their states, on the app&rsquo;s appearance
        tokens. Pages build from these instead of their own markup. Synthetic
        content; pressing a control only reports it below.
      </p>
      <p className={styles.log} role="status" data-testid="gallery-last">
        {last}
      </p>

      <div className={styles.grid}>
        <section className={cx(styles.cell, styles.wide)}>
          <h2>Panel header with toolbar</h2>
          <div className={styles.pane}>
            <PanelHeader
              title="Buildings"
              meta={
                <>
                  <HeaderCount>12 of 340</HeaderCount>
                  <StatusTag status="simulated" />
                </>
              }
              actions={
                <Toolbar
                  aria-label="Building table actions"
                  items={tableTools}
                  onBlocked={blocked}
                />
              }
              description="Synthetic buildings in Back Bay."
            />
          </div>
        </section>

        <section className={cx(styles.cell, styles.wide)}>
          <h2>Data table</h2>
          <p className={componentStyles.muted}>
            Hover the table for its tools and a column header for its filter and
            format; tools in use stay visible.
          </p>
          <DataTable
            id="gallery.buildings"
            aria-label="Gallery buildings"
            columns={BUILDING_COLUMNS}
            rows={BUILDINGS}
            rowKey={(row) => row.id}
            settings={tableSettings}
            onChange={(change) => {
              setTableSettings((current) => applyTableChange(current, change))
              note(`Table change: ${change.kind}.`)
            }}
            pageSize={15}
            exportOptions={{ fileName: 'gallery-buildings.csv' }}
            onExport={(_csv, fileName, rowCount) =>
              note(`Exported ${rowCount} rows as ${fileName}.`)
            }
          />
          <DataTable
            id="gallery.empty"
            aria-label="Gallery empty table"
            columns={BUILDING_COLUMNS}
            rows={[]}
            rowKey={(row) => row.id}
            settings={defaultTableSettings()}
            onChange={() => note('Empty table changed.')}
            emptyText="No buildings yet. Run Geospatial preprocessing."
          />
        </section>

        <section className={styles.cell}>
          <h2>Toolbar overflow</h2>
          <p className={componentStyles.muted}>
            Drag the dashed frame&rsquo;s corner. Items leave from the end into
            More; the primary action stays.
          </p>
          <div
            className={cx(styles.resizable, styles.narrow)}
            data-testid="narrow-toolbar"
          >
            <Toolbar
              aria-label="Narrow table actions"
              items={tableTools}
              onBlocked={blocked}
            />
          </div>
        </section>

        <section className={styles.cell}>
          <h2>Menu button</h2>
          <div className={styles.row}>
            <MenuButton
              label="Export"
              showChevron
              groups={[
                {
                  id: 'files',
                  title: 'Files',
                  items: [
                    { id: 'csv', label: 'CSV', shortcut: 'Ctrl+E' },
                    {
                      id: 'json',
                      label: 'JSON',
                      description: 'With provenance',
                    },
                  ],
                },
                {
                  id: 'report',
                  items: [
                    {
                      id: 'pdf',
                      label: 'PDF report',
                      disabledReason: 'Reports are planned.',
                    },
                  ],
                },
              ]}
              onAction={(id) => note(`Export ${id} chosen.`)}
              onBlocked={blocked}
            />
            <MenuButton
              label={<SlidersHorizontal size={14} aria-hidden="true" />}
              aria-label="Choose columns"
              variant="quiet"
              selectionMode="multiple"
              selectedKeys={columns}
              onSelectionChange={(keys) => {
                setColumns(keys)
                note(`Columns: ${[...keys].join(', ') || 'none'}.`)
              }}
              groups={[
                {
                  id: 'columns',
                  title: 'Columns',
                  items: [
                    { id: 'id', label: 'ID' },
                    { id: 'name', label: 'Name' },
                    { id: 'demand', label: 'Annual demand' },
                    { id: 'peak', label: 'Peak load' },
                  ],
                },
              ]}
              onAction={() => undefined}
            />
          </div>
        </section>

        <section className={styles.cell}>
          <h2>Segmented filter</h2>
          <SegmentedFilter
            aria-label="Show jobs"
            segments={[
              { id: 'all', label: 'All', count: 14 },
              { id: 'active', label: 'Active', count: 2 },
              { id: 'attention', label: 'Needs attention', count: 1 },
            ]}
            value={filter}
            onChange={(value) => {
              setFilter(value)
              note(`Showing ${value} jobs.`)
            }}
          />
          <SegmentedFilter
            aria-label="Resolution"
            segments={[
              { id: 'monthly', label: 'Monthly' },
              {
                id: 'hourly',
                label: 'Typical weekday (hourly)',
                disabledReason: 'Select a building to see its hourly shape.',
              },
            ]}
            value={resolution}
            onChange={setResolution}
          />
        </section>

        <section className={cx(styles.cell, styles.wide)}>
          <h2>Inline alerts</h2>
          <InlineAlert tone="info" title="Synthetic data">
            Values come from the demo generator, not measured data.
          </InlineAlert>
          <InlineAlert tone="success" live="off">
            Saved scenario &ldquo;Envelope retrofit&rdquo;.
          </InlineAlert>
          <InlineAlert
            tone="warning"
            title="Results are outdated"
            actions={
              <button
                type="button"
                className={componentStyles.button}
                onClick={() => note('Rerun pressed.')}
              >
                Rerun
              </button>
            }
          >
            Archetypes changed after the last scenario run.
          </InlineAlert>
          <InlineAlert tone="danger" live="off" title="Fit failed">
            The meter series has 3 months missing.
          </InlineAlert>
        </section>

        <section className={styles.cell}>
          <h2>Toasts</h2>
          {SAMPLE_MESSAGES.slice(0, 3).map((message) => (
            <Toast
              key={message.id}
              message={message}
              onAction={(action) => note(`${action.label} pressed.`)}
              onDismiss={() => note('Dismissed.')}
            />
          ))}
        </section>

        <section className={styles.cell}>
          <h2>Message history</h2>
          <ol className={messageStyles.list} aria-label="Message history">
            {SAMPLE_MESSAGES.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                onAction={(action) => note(`${action.label} pressed.`)}
              />
            ))}
          </ol>
        </section>

        <section className={styles.cell}>
          <h2>Property list</h2>
          <PropertyList
            items={[
              { label: 'Building', value: 'B0042', mono: true },
              { label: 'Use', value: 'Office' },
              { label: 'Annual demand', value: formatEnergy(1_234_567) },
              {
                label: 'Peak load',
                value: formatNumber(412.6, { unit: 'kW' }),
              },
              { label: 'Floor area', value: formatNumber(null) },
              {
                label: 'Updated',
                value: formatDateTime(Date.UTC(2026, 9, 26)),
              },
            ]}
          />
        </section>

        <section className={styles.cell}>
          <h2>Section</h2>
          <Section title="Show monthly data table" count={12} id="gallery">
            <table className={componentStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Demand (MWh)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Jan</td>
                  <td>{formatNumber(1204.2, { maxDigits: 1 })}</td>
                </tr>
                <tr>
                  <td>Feb</td>
                  <td>{formatNumber(1098.7, { maxDigits: 1 })}</td>
                </tr>
              </tbody>
            </table>
          </Section>
          <Section title="Held results" count={0} defaultExpanded>
            <p className={componentStyles.empty}>{formatCount(0, 'result')}.</p>
          </Section>
        </section>

        <section className={styles.cell}>
          <h2>State and capability badges</h2>
          <div className={styles.row}>
            {STATES.map((state) => (
              <StateBadge key={state} state={state} />
            ))}
          </div>
          <div className={styles.row}>
            <StatusTag status="working" />
            <StatusTag status="simulated" />
            <StatusTag status="planned" />
          </div>
        </section>

        <section className={styles.cell}>
          <h2>Buttons</h2>
          <div className={styles.row}>
            <button
              type="button"
              className={componentStyles.button}
              onClick={() => note('Button pressed.')}
            >
              Button
            </button>
            <button
              type="button"
              className={cx(componentStyles.button, componentStyles.primary)}
              onClick={() => note('Primary pressed.')}
            >
              Primary
            </button>
            <button
              type="button"
              className={componentStyles.button}
              aria-disabled="true"
              title="Nothing to undo."
              onClick={() => note('Undo is unavailable: Nothing to undo.')}
            >
              Unavailable
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
