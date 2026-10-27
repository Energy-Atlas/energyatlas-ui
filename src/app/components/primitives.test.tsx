import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { InlineAlert } from './InlineAlert.tsx'
import { MenuButton } from './MenuButton.tsx'
import { PanelHeader } from './PanelHeader.tsx'
import { PropertyList } from './PropertyList.tsx'
import { Section } from './Section.tsx'
import { SegmentedFilter } from './SegmentedFilter.tsx'
import { Toolbar } from './Toolbar.tsx'

afterEach(cleanup)

// jsdom has no CSS.escape, which React Aria's menus use to find items.
if (typeof globalThis.CSS?.escape !== 'function') {
  Object.assign(globalThis, {
    CSS: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') },
  })
}

describe('PanelHeader', () => {
  test('labels its heading and keeps controls apart from the title', () => {
    render(
      <PanelHeader
        title="Jobs"
        headingId="jobs-heading"
        meta={<span>Simulated</span>}
        actions={<button type="button">Refresh</button>}
      />,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'Jobs' })
    expect(heading.id).toBe('jobs-heading')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })
})

describe('InlineAlert', () => {
  test('errors interrupt and name their tone', () => {
    render(<InlineAlert tone="danger">The fit failed.</InlineAlert>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('The fit failed.')
    expect(screen.getByRole('img', { name: 'Error' })).toBeTruthy()
  })

  test('notices present from the start are not announced', () => {
    render(<InlineAlert tone="warning">Results are outdated.</InlineAlert>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('results of an action are announced politely', () => {
    render(
      <InlineAlert tone="success" live="polite">
        Saved.
      </InlineAlert>,
    )
    expect(screen.getByRole('status').textContent).toContain('Saved.')
  })
})

describe('PropertyList', () => {
  test('pairs labels with values and skips optional rows', () => {
    render(
      <PropertyList
        items={[
          { label: 'Stage', value: 'Scenario modeling' },
          null,
          false,
          { label: 'Building', value: 'B0042', mono: true },
        ]}
      />,
    )
    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    expect(terms).toEqual(['Stage', 'Building'])
    expect(screen.getAllByRole('definition')[1]?.textContent).toBe('B0042')
  })
})

describe('Section', () => {
  test('opens on demand and remembers its state by id', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <Section title="Show data table" id="test.remember" count={3}>
        <p>Rows</p>
      </Section>,
    )
    const trigger = screen.getByRole('button', { name: /Show data table/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    unmount()
    render(
      <Section title="Show data table" id="test.remember">
        <p>Rows</p>
      </Section>,
    )
    expect(
      screen
        .getByRole('button', { name: /Show data table/ })
        .getAttribute('aria-expanded'),
    ).toBe('true')
  })
})

describe('SegmentedFilter', () => {
  test('reads as radios with counts and reports a new choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedFilter
        aria-label="Show jobs"
        segments={[
          { id: 'all', label: 'All', count: 4 },
          { id: 'active', label: 'Active', count: 1 },
        ]}
        value="all"
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Show jobs' })).toBeTruthy()
    const all = screen.getByRole('radio', { name: 'All, 4' })
    expect(all.getAttribute('aria-checked')).toBe('true')
    await user.click(screen.getByRole('radio', { name: 'Active, 1' }))
    expect(onChange).toHaveBeenCalledWith('active')
    // Choosing the current value again keeps it rather than clearing it.
    onChange.mockClear()
    await user.click(all)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('an unavailable choice is disabled and describes why', () => {
    render(
      <SegmentedFilter
        aria-label="Resolution"
        segments={[
          { id: 'monthly', label: 'Monthly' },
          {
            id: 'hourly',
            label: 'Hourly',
            disabledReason: 'Select a building first.',
          },
        ]}
        value="monthly"
        onChange={() => undefined}
      />,
    )
    const hourly = screen.getByRole('radio', { name: 'Hourly' })
    expect(hourly.hasAttribute('disabled')).toBe(true)
    const describedBy = hourly.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Select a building first.',
    )
  })
})

describe('MenuButton', () => {
  test('runs an entry and explains an unavailable one', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onBlocked = vi.fn()
    render(
      <MenuButton
        label="Export"
        groups={[
          {
            id: 'files',
            items: [
              { id: 'csv', label: 'CSV' },
              { id: 'pdf', label: 'PDF', disabledReason: 'Planned.' },
            ],
          },
        ]}
        onAction={onAction}
        onBlocked={onBlocked}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(screen.getByRole('menuitem', { name: /CSV/ }))
    expect(onAction).toHaveBeenCalledWith('csv')

    await user.click(screen.getByRole('button', { name: 'Export' }))
    const pdf = screen.getByRole('menuitem', { name: /PDF/ })
    // Greyed out, its reason the tooltip and its (hidden) description.
    expect(pdf.getAttribute('title')).toBe('Planned.')
    expect(pdf.getAttribute('aria-disabled')).toBe('true')
    expect(pdf.textContent).toContain('Planned.')
    await user.click(pdf)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pdf' }),
      'Planned.',
    )
  })
})

describe('Toolbar', () => {
  test('is one tab stop with arrow keys between its buttons', async () => {
    const user = userEvent.setup()
    const pressed = vi.fn()
    render(
      <Toolbar
        aria-label="Table actions"
        items={[
          { id: 'columns', label: 'Columns', onPress: pressed },
          { id: 'filter', label: 'Filter', onPress: pressed },
        ]}
      />,
    )
    const toolbar = screen.getByRole('toolbar', { name: 'Table actions' })
    expect(toolbar).toBeTruthy()
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Columns')
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement?.textContent).toBe('Filter')
    await user.keyboard('{Enter}')
    expect(pressed).toHaveBeenCalledTimes(1)
  })

  test('an unavailable item reports its reason instead of running', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const onBlocked = vi.fn()
    render(
      <Toolbar
        aria-label="Table actions"
        items={[
          {
            id: 'refresh',
            label: 'Refresh',
            onPress,
            disabledReason: 'Results are current.',
          },
        ]}
        onBlocked={onBlocked}
      />,
    )
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    await user.click(refresh)
    expect(onPress).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'refresh' }),
      'Results are current.',
    )
  })
})
