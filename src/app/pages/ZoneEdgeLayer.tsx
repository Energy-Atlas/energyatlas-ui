import type { MapRef } from '@vis.gl/react-maplibre'
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react'
import { cameraPosition } from './mapPicking.ts'
import { toMercator } from './silhouette.ts'
import type { EdgeRole, EdgeStyle, ZoneEdges } from './zoneFeatures.ts'
import { ZONE_EDGES_LAYER_ID } from './ZoneLayers.tsx'

// Zone edges in 3D (decisions 0034 and 0036). MapLibre draws no outlines on
// extrusions and cannot raise line layers, so, like the selection silhouette
// (SelectionSilhouette.tsx), a custom layer takes MapLibre's projection matrix
// every frame. Unlike the silhouette it draws in WebGL into MapLibre's own
// depth buffer, so an edge behind a zone is hidden by it: each edge is a thin
// screen-space quad. To win over the faces it lies on, each vertex is pulled
// towards the camera along its own line of sight by one and a half pixels'
// worth of distance, which leaves it where it is on screen; the fixed depth
// bias used before let edges several metres behind a face show through as
// short tails near silhouettes. Envelope edges and zone boundaries take their
// own colours. Coordinates are sent relative to each building's first corner
// and the matrix is offset in double precision, so edges do not jitter at
// street zoom.

const ZONE_EDGE_LAYER_ID = ZONE_EDGES_LAYER_ID

/**
 * Edge widths in CSS pixels by style (decision 0035): zone edges, the
 * emphasised edges of a selected floor, a selected zone's, and the thin
 * edges of hollow floors.
 */
const WIDTH_PX: Record<EdgeStyle, number> = {
  zone: 1.5,
  focus: 2.25,
  selected: 3,
  hollow: 1,
}
/** How far edges are pulled towards the camera, in pixels' worth of distance. */
const PULL_PX = 1.5
/** Matches MapLibre's earth circumference for Mercator altitude units. */
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_371_008.8

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_width;
uniform vec3 u_camera;
uniform float u_pull;
in vec3 a_pos;
in vec3 a_other;
in float a_side;
void main() {
  // Along its line of sight, a point keeps its place on screen.
  vec4 here = u_matrix * vec4(mix(a_pos, u_camera, u_pull), 1.0);
  vec4 there = u_matrix * vec4(mix(a_other, u_camera, u_pull), 1.0);
  vec2 a = here.xy / here.w;
  vec2 b = there.xy / there.w;
  vec2 along = (b - a) * u_viewport;
  float length2 = dot(along, along);
  vec2 direction = length2 > 0.0 ? along / sqrt(length2) : vec2(1.0, 0.0);
  vec2 normal = vec2(-direction.y, direction.x);
  vec2 offset = normal * a_side * u_width / u_viewport;
  gl_Position = vec4(here.xy + offset * here.w, here.z, here.w);
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`

/** A colour token (#rgb, #rrggbb, or rgb()/rgba(), as the appearances write them) as straight RGBA from 0 to 1. */
export function parseColor(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const digits = hex[1] ?? ''
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : digits
    const value = Number.parseInt(full, 16)
    return [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
      1,
    ]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim())
  if (rgb) {
    const parts = (rgb[1] ?? '').split(/[\s,/]+/).filter(Boolean)
    const channel = (index: number) => Number(parts[index] ?? 0) / 255
    const alpha = parts[3] === undefined ? 1 : Number(parts[3])
    return [channel(0), channel(1), channel(2), alpha]
  }
  return [0, 0, 0, 1]
}

type Mesh = {
  buildingId: string
  anchor: [number, number]
  /** Mercator origin of the coordinates. */
  origin: [number, number, number]
  /** One buffer per edge style and role, drawn hollow first and selected last. */
  parts: {
    data: Float32Array
    count: number
    style: EdgeStyle
    role: EdgeRole
  }[]
}

/** Six vertices (two triangles) per segment: position, other end, side. */
export function edgeVertices(
  segments: number[],
  origin: [number, number, number],
): Float32Array {
  const count = Math.floor(segments.length / 6)
  const data = new Float32Array(count * 6 * 7)
  let offset = 0
  const push = (
    here: [number, number, number],
    there: [number, number, number],
    side: number,
  ) => {
    data[offset++] = here[0] - origin[0]
    data[offset++] = here[1] - origin[1]
    data[offset++] = here[2] - origin[2]
    data[offset++] = there[0] - origin[0]
    data[offset++] = there[1] - origin[1]
    data[offset++] = there[2] - origin[2]
    data[offset++] = side
  }
  for (let index = 0; index < count; index += 1) {
    const at = index * 6
    const a = toMercator(
      [segments[at] ?? 0, segments[at + 1] ?? 0],
      segments[at + 2] ?? 0,
    )
    const b = toMercator(
      [segments[at + 3] ?? 0, segments[at + 4] ?? 0],
      segments[at + 5] ?? 0,
    )
    // Seen from b, the normal turns round, so b's sides are swapped.
    push(a, b, 1)
    push(a, b, -1)
    push(b, a, -1)
    push(a, b, -1)
    push(b, a, 1)
    push(b, a, -1)
  }
  return data
}

function buildMeshes(groups: ZoneEdges[]): Mesh[] {
  return groups.flatMap((group) => {
    const first = group.parts.find((part) => part.segments.length >= 6)
    if (!first) return []
    const origin = toMercator(
      [first.segments[0] ?? 0, first.segments[1] ?? 0],
      0,
    )
    return [
      {
        buildingId: group.buildingId,
        anchor: group.anchor,
        origin,
        parts: group.parts
          .filter((part) => part.segments.length >= 6)
          .map((part) => ({
            data: edgeVertices(part.segments, origin),
            count: part.segments.length,
            style: part.style,
            role: part.role,
          })),
      },
    ]
  })
}

/** `matrix` times a translation to `origin`, in double precision. */
export function translated(
  matrix: ArrayLike<number>,
  origin: [number, number, number],
): Float32Array {
  const m = (index: number) => matrix[index] ?? 0
  const out = new Float32Array(16)
  for (let index = 0; index < 12; index += 1) out[index] = m(index)
  for (let row = 0; row < 4; row += 1) {
    out[12 + row] =
      m(row) * origin[0] +
      m(4 + row) * origin[1] +
      m(8 + row) * origin[2] +
      m(12 + row)
  }
  return out
}

type Rgba = [number, number, number, number]

type Colors = {
  roles: Record<EdgeRole, Rgba>
  selected: Rgba
  /** The alpha of hollow floors' edges (an appearance token). */
  hollowAlpha: number
}

type Input = Colors & { meshes: Mesh[] }

/**
 * An edge's colour: the selection colour for a selected zone's edges, else
 * its role's colour (envelope or zone boundary), faint on hollow floors.
 */
export function colorOf(
  colors: Colors,
  style: EdgeStyle,
  role: EdgeRole,
): Rgba {
  if (style === 'selected') return colors.selected
  const [r, g, b, a] = colors.roles[role]
  return style === 'hollow' ? [r, g, b, a * colors.hollowAlpha] : [r, g, b, a]
}

type GlState = {
  /** The context the resources belong to; only it can delete them. */
  gl: WebGL2RenderingContext
  program: WebGLProgram
  /**
   * The layer's own vertex array: enabling attributes on whichever array
   * MapLibre left bound would break MapLibre's next draw with it.
   */
  vertexArray: WebGLVertexArrayObject
  /** One buffer per part, uploaded once; replaced when the meshes change. */
  buffers: Map<Float32Array, WebGLBuffer>
  meshes: Mesh[] | null
  locations: {
    matrix: WebGLUniformLocation | null
    viewport: WebGLUniformLocation | null
    width: WebGLUniformLocation | null
    camera: WebGLUniformLocation | null
    pull: WebGLUniformLocation | null
    color: WebGLUniformLocation | null
    pos: number
    other: number
    side: number
  }
}

/** Deletes a layer's GL resources, when the context they belong to is the one given. */
export function releaseGl(state: GlState, gl: WebGL2RenderingContext): void {
  // Resources of another (lost or replaced) context cannot be deleted here.
  if (state.gl !== gl) return
  gl.deleteProgram(state.program)
  gl.deleteVertexArray(state.vertexArray)
  for (const buffer of state.buffers.values()) gl.deleteBuffer(buffer)
  state.buffers.clear()
  state.meshes = null
}

function compile(gl: WebGL2RenderingContext): GlState | null {
  const shader = (type: number, source: string) => {
    const result = gl.createShader(type)
    if (!result) return null
    gl.shaderSource(result, source)
    gl.compileShader(result)
    if (gl.getShaderParameter(result, gl.COMPILE_STATUS)) return result
    gl.deleteShader(result)
    return null
  }
  const vertex = shader(gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  const vertexArray = gl.createVertexArray()
  const discard = () => {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    if (program) gl.deleteProgram(program)
    if (vertexArray) gl.deleteVertexArray(vertexArray)
  }
  if (!vertex || !fragment || !program || !vertexArray) {
    discard()
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean
  // A linked program keeps its code; the shaders are no longer needed.
  gl.detachShader(program, vertex)
  gl.detachShader(program, fragment)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!linked) {
    gl.deleteProgram(program)
    gl.deleteVertexArray(vertexArray)
    return null
  }
  return {
    gl,
    program,
    vertexArray,
    buffers: new Map(),
    meshes: null,
    locations: {
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      viewport: gl.getUniformLocation(program, 'u_viewport'),
      width: gl.getUniformLocation(program, 'u_width'),
      camera: gl.getUniformLocation(program, 'u_camera'),
      pull: gl.getUniformLocation(program, 'u_pull'),
      color: gl.getUniformLocation(program, 'u_color'),
      pos: gl.getAttribLocation(program, 'a_pos'),
      other: gl.getAttribLocation(program, 'a_other'),
      side: gl.getAttribLocation(program, 'a_side'),
    },
  }
}

/**
 * The share of a vertex's distance to the camera that is `pixels` pixels'
 * worth of distance there: a pixel spans the field of view over the canvas
 * height, at any distance.
 */
export function pullShare(
  fovDeg: number,
  heightPx: number,
  pixels = PULL_PX,
): number {
  const pixelAngle = (2 * Math.tan((fovDeg * Math.PI) / 360)) / heightPx
  return Math.min(0.5, pixels * pixelAngle)
}

function render(
  map: MapLibreMap,
  gl: WebGL2RenderingContext,
  state: GlState,
  matrix: ArrayLike<number>,
  input: Input,
): void {
  if (state.meshes !== input.meshes) {
    for (const buffer of state.buffers.values()) gl.deleteBuffer(buffer)
    state.buffers.clear()
    state.meshes = input.meshes
  }
  if (input.meshes.length === 0) return
  const { program, locations } = state
  gl.useProgram(program)
  gl.bindVertexArray(state.vertexArray)
  const ratio = window.devicePixelRatio || 1
  gl.uniform2f(
    locations.viewport,
    gl.drawingBufferWidth / 2,
    gl.drawingBufferHeight / 2,
  )
  const center = map.getCenter()
  const heightPx = map.getCanvas().clientHeight || 1
  const fovDeg = map.getVerticalFieldOfView()
  const camera = cameraPosition({
    center: [center.lng, center.lat],
    centerElevationM: map.getCenterElevation(),
    zoom: map.getZoom(),
    pitchDeg: map.getPitch(),
    bearingDeg: map.getBearing(),
    fovDeg,
    heightPx,
  })
  gl.uniform1f(locations.pull, pullShare(fovDeg, heightPx))
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.disable(gl.CULL_FACE)
  const stride = 7 * 4
  gl.enableVertexAttribArray(locations.pos)
  gl.enableVertexAttribArray(locations.other)
  gl.enableVertexAttribArray(locations.side)
  for (const mesh of input.meshes) {
    // With terrain on, MapLibre stands each extrusion on the elevation at its
    // centroid; lift the edges by the same sample.
    const elevation = map.queryTerrainElevation(mesh.anchor) ?? 0
    const lift =
      elevation /
      (EARTH_CIRCUMFERENCE_M * Math.cos((mesh.anchor[1] * Math.PI) / 180))
    const origin: [number, number, number] = [
      mesh.origin[0],
      mesh.origin[1],
      mesh.origin[2] + lift,
    ]
    gl.uniformMatrix4fv(locations.matrix, false, translated(matrix, origin))
    gl.uniform3f(
      locations.camera,
      camera[0] - origin[0],
      camera[1] - origin[1],
      camera[2] - origin[2],
    )
    for (const part of mesh.parts) {
      const [r, g, b, a] = colorOf(input, part.style, part.role)
      gl.uniform4f(locations.color, r * a, g * a, b * a, a)
      gl.uniform1f(locations.width, (WIDTH_PX[part.style] * ratio) / 2)
      let buffer = state.buffers.get(part.data)
      if (!buffer) {
        const created = gl.createBuffer()
        if (!created) continue
        buffer = created
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, part.data, gl.STATIC_DRAW)
        state.buffers.set(part.data, buffer)
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      }
      gl.vertexAttribPointer(locations.pos, 3, gl.FLOAT, false, stride, 0)
      gl.vertexAttribPointer(locations.other, 3, gl.FLOAT, false, stride, 12)
      gl.vertexAttribPointer(locations.side, 1, gl.FLOAT, false, stride, 24)
      gl.drawArrays(gl.TRIANGLES, 0, part.count)
    }
  }
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

type Props = {
  mapRef: RefObject<MapRef | null>
  loaded: boolean
  enabled: boolean
  edges: ZoneEdges[]
  /** The envelope's and the zone boundaries' colours (appearance tokens). */
  envelopeColor: string
  boundaryColor: string
  selectedColor: string
  /** The alpha of hollow floors' edges (an appearance token). */
  hollowAlpha: number
}

/**
 * Draws zone edges while the zones are extruded in 3D. Renders nothing in
 * React: the layer lives in the map's style, and is added back after style
 * swaps as the silhouette's is.
 */
export function ZoneEdgeLayer({
  mapRef,
  loaded,
  enabled,
  edges,
  envelopeColor,
  boundaryColor,
  selectedColor,
  hollowAlpha,
}: Props) {
  const meshes = useMemo(() => buildMeshes(edges), [edges])
  const inputOf = (): Input => ({
    meshes,
    roles: {
      envelope: parseColor(envelopeColor),
      boundary: parseColor(boundaryColor),
    },
    selected: parseColor(selectedColor),
    hollowAlpha,
  })
  const latest = useRef<Input>(inputOf())

  useLayoutEffect(() => {
    latest.current = {
      meshes,
      roles: {
        envelope: parseColor(envelopeColor),
        boundary: parseColor(boundaryColor),
      },
      selected: parseColor(selectedColor),
      hollowAlpha,
    }
    mapRef.current?.getMap().triggerRepaint()
  }, [meshes, envelopeColor, boundaryColor, selectedColor, hollowAlpha, mapRef])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || !enabled) return
    let glState: GlState | null = null
    const layer: CustomLayerInterface = {
      id: ZONE_EDGE_LAYER_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd: (_map, gl) => {
        // A full style reload drops custom layers without onRemove, and the
        // same layer object is added again: release what it held first.
        if (glState) releaseGl(glState, gl)
        glState = compile(gl)
      },
      onRemove: (_map, gl) => {
        if (glState) releaseGl(glState, gl)
        glState = null
      },
      render: (gl, options) => {
        // Only the Mercator matrix is supported; at street zoom the globe
        // has blended into Mercator, and zones are not drawn further out.
        const projection = options.defaultProjectionData
        if (!glState || projection.projectionTransition > 0.001) return
        render(map, gl, glState, projection.mainMatrix, latest.current)
      },
    }
    const ensureLayer = () => {
      if (map.getLayer(ZONE_EDGE_LAYER_ID)) return
      try {
        map.addLayer(layer)
      } catch {
        // The style is still loading; the next styledata event retries.
      }
    }
    ensureLayer()
    map.on('styledata', ensureLayer)
    map.triggerRepaint()
    return () => {
      map.off('styledata', ensureLayer)
      try {
        if (map.getLayer(ZONE_EDGE_LAYER_ID))
          map.removeLayer(ZONE_EDGE_LAYER_ID)
      } catch {
        // The map is being removed with its style.
      }
      // The layer may have left the style already without onRemove.
      if (glState) releaseGl(glState, glState.gl)
      glState = null
    }
  }, [mapRef, loaded, enabled])

  return null
}
