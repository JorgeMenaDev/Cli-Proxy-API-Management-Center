/**
 * Claude Ledger: pure numbers behind the compact credential table.
 * React-free and clock-free (`now` is passed in) so tests/claudeLedger.test.ts
 * can drive every case directly.
 */

import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import type { AuthFileItem, ClaudeQuotaState, ClaudeQuotaWindow } from '@/types';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

/** Below this much weekly quota left, a cell turns amber and carries a "Low" tag. */
export const LEDGER_LOW_REMAINING_PERCENT = 20;

/** Window ids built by `buildClaudeQuotaWindows`. */
const WEEKLY_ID = 'seven-day';
const FABLE_ID = 'seven-day-fable';
const FIVE_HOUR_ID = 'five-hour';

export interface LedgerWindow {
  /** Percent left (100 − used), or null when the window reported no usage. */
  remaining: number | null;
  resetAtMs: number | null;
}

export interface LedgerWindows {
  weekly: LedgerWindow | null;
  fable: LedgerWindow | null;
  fiveHour: LedgerWindow | null;
}

export const remainingPercent = (usedPercent: number | null | undefined): number | null =>
  typeof usedPercent === 'number' && Number.isFinite(usedPercent)
    ? Math.min(100, Math.max(0, 100 - usedPercent))
    : null;

export const isLowRemaining = (remaining: number | null): boolean =>
  remaining !== null && remaining < LEDGER_LOW_REMAINING_PERCENT;

const toLedgerWindow = (window: ClaudeQuotaWindow | undefined): LedgerWindow | null =>
  window
    ? { remaining: remainingPercent(window.usedPercent), resetAtMs: window.resetAtMs ?? null }
    : null;

/** The three windows the ledger shows, read from whatever the quota state holds. */
export function readLedgerWindows(quota: ClaudeQuotaState | undefined): LedgerWindows {
  const windows = quota?.windows ?? [];
  const byId = (id: string) => windows.find((window) => window.id === id);
  return {
    weekly: toLedgerWindow(byId(WEEKLY_ID)),
    fable: toLedgerWindow(byId(FABLE_ID)),
    fiveHour: toLedgerWindow(byId(FIVE_HOUR_ID)),
  };
}

export interface LedgerPool {
  /** Sum of weekly % left over credentials that reported a weekly window. */
  leftPercent: number;
  /** 100% per credential counted in `leftPercent`. */
  totalPercent: number;
  /** What comes back at the soonest weekly reset, or null when none is upcoming. */
  nextReset: { atMs: number; gainPercent: number } | null;
}

/**
 * Pool the weekly windows of one provider group. Credentials not loaded yet are
 * left out of both sides rather than counted as empty. Resets landing in the same
 * minute are one event: their used percentages add up to the gain.
 */
export function summarizeLedgerPool(
  weeklies: readonly (LedgerWindow | null)[],
  now: number
): LedgerPool {
  const known = weeklies.filter(
    (window): window is LedgerWindow & { remaining: number } => window?.remaining != null
  );
  const minuteOf = (ms: number) => Math.floor(ms / MINUTE_MS);
  const upcoming = known.filter(
    (window): window is { remaining: number; resetAtMs: number } =>
      window.resetAtMs !== null && window.resetAtMs > now
  );
  const soonest = upcoming.reduce<number | null>(
    (min, window) => (min === null || window.resetAtMs < min ? window.resetAtMs : min),
    null
  );
  return {
    leftPercent: Math.round(known.reduce((sum, window) => sum + window.remaining, 0)),
    totalPercent: known.length * 100,
    nextReset:
      soonest === null
        ? null
        : {
            atMs: soonest,
            gainPercent: Math.round(
              upcoming
                .filter((window) => minuteOf(window.resetAtMs) === minuteOf(soonest))
                .reduce((sum, window) => sum + (100 - window.remaining), 0)
            ),
          },
  };
}

/**
 * "account" grants clear the whole weekly limit; "model" grants are scoped to one
 * model (e.g. the Fable launch reset), whose window is not among the ones we parse,
 * so their `clears` list carries no weekly window.
 */
export type ResetGrantKind = 'account' | 'model';

export interface ResetGrantSummary {
  kind: ResetGrantKind;
  /** Resets left across the grants of this kind. */
  count: number;
  /** Soonest expiry among them, or null when none states one. */
  expiresAtMs: number | null;
}

export const resetGrantKind = (grant: AnthropicResetGrant): ResetGrantKind =>
  grant.clears.includes('seven_day') ? 'account' : 'model';

/** Live grants with resets left, folded to one line per kind (account first). */
export function summarizeResetGrants(
  grants: readonly AnthropicResetGrant[],
  now: number
): ResetGrantSummary[] {
  const kinds: ResetGrantKind[] = ['account', 'model'];
  return kinds.flatMap((kind) => {
    const live = grants.filter((grant) => {
      const endsAtMs = grant.endsAt ? Date.parse(grant.endsAt) : null;
      return (
        resetGrantKind(grant) === kind &&
        grant.resetsLeft > 0 &&
        (endsAtMs === null || endsAtMs > now)
      );
    });
    if (live.length === 0) return [];
    const expiries = live.flatMap((grant) => (grant.endsAt ? [Date.parse(grant.endsAt)] : []));
    return [
      {
        kind,
        count: live.reduce((sum, grant) => sum + grant.resetsLeft, 0),
        expiresAtMs: expiries.length > 0 ? Math.min(...expiries) : null,
      },
    ];
  });
}

/** i18n key suffix plus values for `quota_management.ledger_duration_*`. */
export interface LedgerDuration {
  key: 'dh' | 'hm' | 'd' | 'h' | 'm';
  days: number;
  hours: number;
  minutes: number;
}

/**
 * Countdown text parts, truncated like `relativeTimeParts`. `fine` keeps two
 * units ("19h 9m", "2d 0h"); `coarse` keeps the largest one ("35d", "13m").
 */
export function ledgerDuration(ms: number, precision: 'fine' | 'coarse'): LedgerDuration {
  const span = Math.max(0, ms);
  const days = Math.floor(span / DAY_MS);
  const hours = Math.floor((span % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((span % HOUR_MS) / MINUTE_MS);
  const parts = { days, hours, minutes };
  if (precision === 'coarse') {
    return { key: days > 0 ? 'd' : hours > 0 ? 'h' : 'm', ...parts };
  }
  return { key: days > 0 ? 'dh' : hours > 0 ? 'hm' : 'm', ...parts };
}

const EMAIL_IN_NAME_RE = /([A-Za-z0-9._%+]+)@([A-Za-z0-9.-]+?)(?:\.json)?$/;

/** The account email: the scanner's field when present, else the one in the filename. */
const accountEmail = (file: AuthFileItem): { local: string; domain: string } | null => {
  const email = file.email?.trim();
  const match = email ? /^(.+)@(.+)$/.exec(email) : EMAIL_IN_NAME_RE.exec(file.name);
  return match ? { local: match[1], domain: match[2] } : null;
};

/**
 * Short row names: the email's domain label ("andesphere", "gmail"). When two
 * credentials share a domain, those fall back to the email local part, then to
 * the full email. No email at all → the filename without its extension.
 */
export function ledgerDisplayNames(files: readonly AuthFileItem[]): string[] {
  const emails = files.map(accountEmail);
  const domainLabel = (domain: string) => domain.split('.')[0] || domain;
  const counts = (values: readonly (string | null)[]) => {
    const map = new Map<string, number>();
    values.forEach((value) => value && map.set(value, (map.get(value) ?? 0) + 1));
    return map;
  };
  const domains = emails.map((email) => (email ? domainLabel(email.domain) : null));
  const locals = emails.map((email) => email?.local ?? null);
  const domainCounts = counts(domains);
  const localCounts = counts(locals);
  return files.map((file, index) => {
    const email = emails[index];
    if (!email) return file.name.replace(/\.json$/i, '');
    if (domainCounts.get(domains[index] ?? '') === 1) return domains[index] ?? email.domain;
    if (localCounts.get(email.local) === 1) return email.local;
    return `${email.local}@${email.domain}`;
  });
}
