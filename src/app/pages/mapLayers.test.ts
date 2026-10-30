import { describe, expect, it } from 'vitest'
import {
  defaultLayers,
  layersDiffer,
  layerSummary,
  newLayer,
  nextLayerId,
  parseStoredLayers,
} from './mapLayers.ts'

describe('map layers', () => {
  it('reads a saved stack, and gives the defaults for a missing or broken one', () => {
    const saved = [newLayer('buildings-2', 'buildings', 'Demand')]
    expect(parseStoredLayers(saved)).toEqual(saved)
    expect(parseStoredLayers(undefined)).toEqual(defaultLayers())
    expect(parseStoredLayers([{ id: 'x' }])).toEqual(defaultLayers())
    // Two layers with one id cannot be told apart.
    expect(parseStoredLayers([saved[0], saved[0]])).toEqual(defaultLayers())
    // An empty stack is a choice, kept as saved.
    expect(parseStoredLayers([])).toEqual([])
  })

  it('drops the floor slab setting of stacks saved with it (decision 0036)', () => {
    const saved = { ...newLayer('buildings', 'buildings'), floorSlabs: true }
    expect(parseStoredLayers([saved])[0]).toEqual(
      newLayer('buildings', 'buildings'),
    )
    // Such a stack is not an unsaved change once read.
    expect(layersDiffer(parseStoredLayers([saved]), [saved])).toBe(false)
    expect(
      layerSummary({ ...newLayer('b', 'buildings'), extrude: false }),
    ).toBe('Floors · 90%')
  })

  it('counts a stack as unchanged only when it matches what was saved', () => {
    expect(layersDiffer(defaultLayers(), undefined)).toBe(false)
    const changed = defaultLayers()
    changed[2] = { ...changed[2]!, colorBy: 'pvYield' }
    expect(layersDiffer(changed, undefined)).toBe(true)
    expect(layersDiffer(changed, changed)).toBe(false)
  })

  it('numbers new layers after their kind and summarizes each one', () => {
    expect(nextLayerId(defaultLayers(), 'buildings')).toBe('buildings-2')
    const hidden = { ...newLayer('b', 'buildings'), visible: false }
    expect(layerSummary(hidden)).toBe('Floors · extruded · 90% · hidden')
    expect(layerSummary(newLayer('g', 'gridLines'))).toBe('')
    expect(layerSummary(newLayer('g', 'gridLines', 'Feeders'))).toBe(
      'Grid lines',
    )
  })
})
