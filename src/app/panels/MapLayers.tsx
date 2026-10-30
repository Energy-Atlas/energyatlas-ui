import { useState } from 'react'
import {
  Checkbox,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  TextField,
} from 'react-aria-components'
import {
  useServices,
  useViewState,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { MenuButton } from '../components/MenuButton.tsx'
import { ReorderableList } from '../components/ReorderableList.tsx'
import formStyles from '../components/forms.module.css'
import {
  BUILDING_COLORS,
  colorLabel,
  LAYER_KINDS,
  layerSummary,
  MAP_LAYER_KINDS,
  type MapLayer,
  type MapLayerKind,
} from '../pages/mapLayers.ts'
import { computeMetric, METRICS } from '../pages/mapMetrics.ts'
import styles from './inspection.module.css'
import { ViewSlider } from './ViewSlider.tsx'

/**
 * The map's layer stack in its Properties (decision 0031): the layers top
 * first, each shown or hidden from its row, reordered by dragging or with
 * Move up and Move down, and the chosen layer's settings below.
 */
export function MapLayersSection() {
  const { view } = useServices()
  const layers = useViewState((state) => state.map.layers)
  const view3d = useViewState((state) => state.map.view3d)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosen =
    layers.find((layer) => layer.id === chosenId) ?? layers[0] ?? null
  const index = chosen ? layers.indexOf(chosen) : -1

  const add = (kind: MapLayerKind) => {
    const before = new Set(layers.map((layer) => layer.id))
    const result = view.execute({ type: 'map.addLayer', input: { kind } })
    if (result.outcome.status !== 'applied') return
    // The new layer is on top; choose it to set it up.
    const added = view
      .getState()
      .map.layers.find((layer) => !before.has(layer.id))
    if (added) setChosenId(added.id)
  }
  const move = (layerId: string, position: number) =>
    view.execute({ type: 'map.moveLayer', input: { layerId, position } })

  return (
    <section className={styles.section} aria-label="Layers">
      <h4>Layers</h4>
      <div className={styles.controls}>
        <div className={styles.toolbarRow}>
          <MenuButton
            label="Add layer"
            showChevron
            groups={[
              {
                id: 'kinds',
                items: MAP_LAYER_KINDS.map((kind) => ({
                  id: kind,
                  label: LAYER_KINDS[kind].label,
                  description: LAYER_KINDS[kind].description,
                })),
              },
            ]}
            onAction={(id) => add(id as MapLayerKind)}
          />
          <ActionButton
            label={chosen ? `Move ${chosen.name} up` : 'Move layer up'}
            disabledReason={
              !chosen
                ? 'Choose a layer first.'
                : index === 0
                  ? `"${chosen.name}" is already on top.`
                  : null
            }
            onPress={() => {
              if (chosen) move(chosen.id, index - 1)
            }}
          >
            Move up
          </ActionButton>
          <ActionButton
            label={chosen ? `Move ${chosen.name} down` : 'Move layer down'}
            disabledReason={
              !chosen
                ? 'Choose a layer first.'
                : index === layers.length - 1
                  ? `"${chosen.name}" is already at the bottom.`
                  : null
            }
            onPress={() => {
              if (chosen) move(chosen.id, index + 1)
            }}
          >
            Move down
          </ActionButton>
          <ActionButton
            label={chosen ? `Remove ${chosen.name}` : 'Remove layer'}
            disabledReason={chosen ? null : 'Choose a layer first.'}
            onPress={() => {
              if (!chosen) return
              view.execute({
                type: 'map.removeLayer',
                input: { layerId: chosen.id },
              })
              setChosenId(null)
            }}
          >
            Remove
          </ActionButton>
        </div>
        <ReorderableList
          aria-label="Map layers, top first"
          items={layers.map((layer) => ({
            id: layer.id,
            title: layer.name,
            meta: layerSummary(layer),
            checked: layer.visible,
          }))}
          selectedId={chosen?.id ?? null}
          onSelect={setChosenId}
          checkLabel={(item) => `Show ${item.title}`}
          onCheck={(layerId, visible) =>
            view.execute({
              type: 'map.setLayerVisible',
              input: { layerId, visible },
            })
          }
          onMove={move}
          empty={
            <p className={styles.muted}>
              The map has no layers. Add one to show buildings or the grid.
            </p>
          }
        />
        {chosen ? (
          <LayerSettings key={chosen.id} layer={chosen} view3d={view3d} />
        ) : null}
      </div>
    </section>
  )
}

function LayerSettings({
  layer,
  view3d,
}: {
  layer: MapLayer
  view3d: boolean
}) {
  const { view } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const [name, setName] = useState(layer.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const hasGrid = Object.keys(state.gridElements).length > 0
  const style = (input: Omit<StyleInput, 'layerId'>) =>
    view.execute({
      type: 'map.setLayerStyle',
      input: { layerId: layer.id, ...input },
    })
  const commitName = () => {
    if (name === layer.name) return
    const result = style({ name })
    setNameError(
      result.outcome.status === 'rejected'
        ? (result.outcome.issues[0]?.message ?? 'Enter a name.')
        : null,
    )
  }
  const unavailable = METRICS.filter(
    (metric) => !computeMetric(state, metric.id).available,
  )

  return (
    <div
      className={styles.controls}
      role="group"
      aria-label={`Settings of ${layer.name}`}
    >
      <TextField
        className={formStyles.field}
        value={name}
        isInvalid={nameError !== null}
        onChange={(value) => {
          setName(value)
          setNameError(null)
        }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitName()
        }}
      >
        <Label className={formStyles.label}>Layer name</Label>
        <Input className={formStyles.input} />
        <FieldError className={formStyles.fieldError}>{nameError}</FieldError>
      </TextField>
      {layer.kind !== 'buildings' && !hasGrid ? (
        <p className={styles.muted}>
          No grid elements yet: run &ldquo;Grid definitions&rdquo; to draw them.
        </p>
      ) : null}
      {layer.kind === 'buildings' ? (
        <>
          <RadioGroup
            className={formStyles.field}
            value={layer.colorBy}
            onChange={(value) => {
              const colorBy = BUILDING_COLORS.find((each) => each === value)
              if (colorBy && colorBy !== layer.colorBy) style({ colorBy })
            }}
          >
            <Label className={formStyles.label}>Color by</Label>
            <div className={formStyles.options}>
              {BUILDING_COLORS.map((color) => (
                <Radio
                  key={color}
                  value={color}
                  className={formStyles.radio}
                  isDisabled={unavailable.some((metric) => metric.id === color)}
                >
                  {colorLabel(color)}
                </Radio>
              ))}
            </div>
            {unavailable.length > 0 ? (
              <p className={formStyles.description}>
                Not available yet:{' '}
                {unavailable
                  .map((metric) => `${metric.label} (${metric.requirement})`)
                  .join(' ')}
              </p>
            ) : null}
          </RadioGroup>
          <Checkbox
            className={formStyles.checkbox}
            isSelected={layer.extrude}
            onChange={(extrude) => style({ extrude })}
          >
            Extrude to height
          </Checkbox>
          <p className={formStyles.description}>
            Floors × 3.2 m (synthetic).
            {view3d
              ? ''
              : ' Extrusion shows in the 3D view, a Basemap setting.'}
          </p>
        </>
      ) : null}
      <ViewSlider
        label="Opacity"
        value={layer.opacityPercent}
        min={0}
        max={100}
        step={5}
        format={(value) => `${value}%`}
        operation={(opacityPercent) => ({
          type: 'map.setLayerStyle',
          input: { layerId: layer.id, opacityPercent },
        })}
      />
    </div>
  )
}

type StyleInput = {
  layerId: string
  name?: string
  opacityPercent?: number
  colorBy?: MapLayer['colorBy']
  extrude?: boolean
}
