import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import type { AnthropicResetGrant } from '../src/services/api/claudeResetGrants';
import type { ClaudeQuotaState } from '../src/types';
import { ClaudeLedger } from '../src/features/quota/providers/claude/ClaudeLedger';
import {
  isLowRemaining,
  ledgerDisplayNames,
  ledgerDuration,
  readLedgerWindows,
  remainingPercent,
  summarizeLedgerPool,
  summarizeResetGrants,
} from '../src/features/quota/providers/claude/ledger';

const NOW = Date.UTC(2026, 10, 11, 12);
const HOUR = 3_600_000;

const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
  id: 'g1',
  label: '',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: null,
  clears: [],
  paused: false,
  usableNow: true,
  useRequiresLimit: true,
  percentUsed: {},
  ...overrides,
});

describe('claude ledger numbers', () => {
  test('remaining is 100 − used, clamped, and low under 20%', () => {
    expect(remainingPercent(45)).toBe(55);
    expect(remainingPercent(130)).toBe(0);
    expect(remainingPercent(null)).toBeNull();
    expect(isLowRemaining(11)).toBe(true);
    expect(isLowRemaining(20)).toBe(false);
    expect(isLowRemaining(null)).toBe(false);
  });

  test('reads weekly, Fable and 5-hour windows by id', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        { id: 'five-hour', label: '', resetLabel: '', usedPercent: 27, resetAtMs: NOW + HOUR },
        { id: 'seven-day', label: '', resetLabel: '', usedPercent: 24, resetAtMs: NOW + 9 * HOUR },
        { id: 'seven-day-fable', label: '', resetLabel: '', usedPercent: 7, resetAtMs: null },
      ],
    };
    expect(readLedgerWindows(quota)).toEqual({
      weekly: { remaining: 76, resetAtMs: NOW + 9 * HOUR },
      fable: { remaining: 93, resetAtMs: null },
      fiveHour: { remaining: 73, resetAtMs: NOW + HOUR },
    });
    expect(readLedgerWindows(undefined).weekly).toBeNull();
  });

  test('pools loaded weekly windows and sums the gain of resets in the soonest minute', () => {
    const pool = summarizeLedgerPool(
      [
        { remaining: 55, resetAtMs: NOW + 19 * HOUR },
        { remaining: 11, resetAtMs: NOW + 7 * HOUR },
        { remaining: 2, resetAtMs: NOW + 7 * HOUR + 20_000 },
        { remaining: 100, resetAtMs: NOW - HOUR },
        null,
        { remaining: null, resetAtMs: NOW + HOUR },
      ],
      NOW
    );
    expect(pool).toEqual({
      leftPercent: 168,
      totalPercent: 400,
      nextReset: { atMs: NOW + 7 * HOUR, gainPercent: 187 },
    });
    expect(summarizeLedgerPool([null], NOW)).toEqual({
      leftPercent: 0,
      totalPercent: 0,
      nextReset: null,
    });
  });

  test('folds live grants per kind with their soonest expiry', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const grants = [
      grant({ id: 'm1', resetsLeft: 2, resetsTotal: 2, endsAt: iso(NOW + 118 * 24 * HOUR) }),
      grant({ id: 'm2', endsAt: iso(NOW + 200 * 24 * HOUR) }),
      grant({
        id: 'a1',
        clears: ['five_hour', 'seven_day', 'seven_day_overage_included'],
        endsAt: iso(NOW + 35 * 24 * HOUR),
      }),
      grant({ id: 'spent', clears: ['seven_day'], resetsLeft: 0 }),
      grant({ id: 'expired', endsAt: iso(NOW - HOUR) }),
    ];
    expect(summarizeResetGrants(grants, NOW)).toEqual([
      { kind: 'account', count: 1, expiresAtMs: NOW + 35 * 24 * HOUR },
      { kind: 'model', count: 3, expiresAtMs: NOW + 118 * 24 * HOUR },
    ]);
  });

  test('durations truncate to two units or the largest one', () => {
    const span = 19 * HOUR + 9 * 60_000 + 59_000;
    expect(ledgerDuration(span, 'fine')).toMatchObject({ key: 'hm', hours: 19, minutes: 9 });
    expect(ledgerDuration(2 * 24 * HOUR, 'fine')).toMatchObject({ key: 'dh', days: 2, hours: 0 });
    expect(ledgerDuration(35 * 24 * HOUR + HOUR, 'coarse')).toMatchObject({ key: 'd', days: 35 });
    expect(ledgerDuration(13 * 60_000, 'coarse')).toMatchObject({ key: 'm', minutes: 13 });
    expect(ledgerDuration(-5, 'fine')).toMatchObject({ key: 'm', minutes: 0 });
  });

  test('names rows by email domain, then local part when domains collide', () => {
    expect(
      ledgerDisplayNames([
        { name: 'claude-b9f69696-admin@andesphere.com.json' },
        { name: 'claude-1.json', email: 'jorge@gmail.com' },
        { name: 'claude-2.json', email: 'ana@gmail.com' },
        { name: 'claude-team.json' },
      ])
    ).toEqual(['andesphere', 'jorge', 'ana', 'claude-team']);
  });
});

describe('claude ledger rendering', () => {
  const original = i18n.language;
  beforeAll(() => i18n.changeLanguage('en'));
  afterAll(() => i18n.changeLanguage(original));

  test('renders pool, remaining, low tag, grants-free row and accessible actions', () => {
    const quotas: Record<string, ClaudeQuotaState> = {
      'a.json': {
        status: 'success',
        observedAt: new Date(Date.now() - 13 * 60_000).toISOString(),
        windows: [
          { id: 'seven-day', label: '', resetLabel: '', usedPercent: 89, resetAtMs: null },
          { id: 'seven-day-fable', label: '', resetLabel: '', usedPercent: 78, resetAtMs: null },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(ClaudeLedger, {
        entries: [
          { file: { name: 'a.json', email: 'me@andesphere.com' }, type: 'claude' },
          { file: { name: 'b.json', email: 'me@gmail.com' }, type: 'claude' },
        ],
        quotaFor: (entry) => quotas[entry.file.name],
        resolvedTheme: 'dark',
        canUseActions: true,
        resettingName: null,
        onRefresh: () => {},
      })
    );
    expect(markup).toContain('11% of 100% pool');
    expect(markup).toContain('11% left');
    expect(markup).toContain('22% left');
    expect(markup).toContain('Low');
    expect(markup).toContain('andesphere');
    // useNow is frozen at module load under SSR, so allow one minute of drift.
    expect(markup).toMatch(/Claude · 1[23]m ago/);
    expect(markup).toContain('aria-label="Reset limits: andesphere"');
    expect(markup).toContain('aria-label="Refresh quota: gmail"');
    // The unloaded credential offers a load instead of empty meters.
    expect(markup).toContain('Click here to refresh quota');
  });
});
