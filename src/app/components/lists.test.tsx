import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { jobLogLevel } from '../pages/jobs/jobView.ts'
import { LogView, logText, type LogEntry } from './LogView.tsx'
import { SelectableList } from './SelectableList.tsx'

afterEach(cleanup)

// jsdom has no CSS.escape, which React Aria's collections use to find items.
if (typeof globalThis.CSS?.escape !== 'function') {
  Object.assign(globalThis, {
    CSS: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') },
  })
}

const ITEMS = [
  { id: 'a', title: 'Office 1990s', meta: 'Office · 1990–1999' },
  {
    id: 'b',
    title: 'Mixed use',
    meta: 'Mixed · Any year',
    description: 'Mixed · Any year',
  },
  { id: 'c', title: 'Retail', meta: 'Retail · Any year' },
]

describe('SelectableList', () => {
  test('names rows by title, follows arrow keys, and narrows by search', async () => {
    const onSelect = vi.fn()
    render(
      <SelectableList
        aria-label="Archetypes"
        items={ITEMS}
        selectedId="a"
        onSelect={onSelect}
        search={{ label: 'Search archetypes' }}
      />,
    )
    const list = screen.getByRole('listbox', { name: 'Archetypes' })
    const first = screen.getByRole('option', { name: 'Office 1990s' })
    expect(first.getAttribute('aria-selected')).toBe('true')
    first.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onSelect).toHaveBeenCalledWith('b')

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search archetypes' }),
      'any year',
    )
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(
      ['Mixed useMixed · Any year'],
    )
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(list.isConnected).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  test('acts on a row, and explains why rows cannot be chosen', async () => {
    const onAction = vi.fn()
    const { rerender } = render(
      <SelectableList
        aria-label="Projects"
        selectionMode="none"
        items={ITEMS}
        onAction={onAction}
      />,
    )
    await userEvent.click(screen.getByRole('option', { name: 'Retail' }))
    expect(onAction).toHaveBeenCalledWith('c')

    rerender(
      <SelectableList
        aria-label="Projects"
        selectionMode="none"
        items={ITEMS}
        onAction={onAction}
        disabledReason="Wait for the current project change to finish."
      />,
    )
    const list = screen.getByRole('listbox', { name: 'Projects' })
    expect(list.getAttribute('aria-describedby')).toBeTruthy()
    expect(
      screen
        .getByRole('option', { name: 'Retail' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
  })

  test('shows its empty state when there is nothing to list', () => {
    render(
      <SelectableList
        aria-label="Library"
        items={[]}
        empty={<p>Every library measure is in the project.</p>}
      />,
    )
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('Every library measure is in the project.'))
  })
})

const LINES: LogEntry[] = [
  {
    id: '1',
    at: '2026-10-26T14:05:00.000Z',
    level: 'info',
    text: 'Started.',
  },
  {
    id: '2',
    at: '2026-10-26T14:06:00.000Z',
    level: 'danger',
    source: 'Server',
    text: 'Not sent.',
    description: 'Offline.',
  },
]

describe('LogView', () => {
  test('writes lines as plain text for Copy and Download', () => {
    expect(logText(LINES)).toBe(
      '2026-10-26T14:05:00.000Z  NOTE  Started.\n2026-10-26T14:06:00.000Z  ERROR  Server  Not sent.  Offline.',
    )
  })

  test('filters to problems and names its log and lines', async () => {
    render(
      <LogView
        aria-label="Job log"
        listLabel="Log of Preprocessing, attempt 1"
        entries={LINES}
        levelFilter
        follow
      />,
    )
    expect(screen.getByRole('log', { name: 'Job log' }).tabIndex).toBe(0)
    const lines = screen.getByRole('list', {
      name: 'Log of Preprocessing, attempt 1',
    })
    expect(lines.children).toHaveLength(2)
    await userEvent.click(screen.getByRole('radio', { name: /^Problems/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(
      screen
        .getByRole('button', { name: 'Follow latest' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  test('reads job log levels from the runner wording', () => {
    expect(jobLogLevel('Started.')).toBe('info')
    expect(
      jobLogLevel('Processed 240 of 464 items; 3 failed in this batch.'),
    ).toBe('warning')
    expect(jobLogLevel('Cancelled.')).toBe('warning')
    expect(jobLogLevel('Failed: Server error.')).toBe('danger')
    expect(jobLogLevel('Completed. Joined 464 footprints.')).toBe('success')
  })
})
