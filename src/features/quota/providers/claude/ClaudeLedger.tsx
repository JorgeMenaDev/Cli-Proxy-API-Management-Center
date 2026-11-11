/**
 * Claude Ledger: one compact table for every Claude credential on the page,
 * with a pooled weekly headline. The card grid stays reachable via the view switch.
 */

import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconRefreshCw, IconTimer, IconZap } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ClaudeQuotaState, ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../../logic';
import { useClaudeResetGrants } from './ClaudeResetGrants';
import { hasClaudeUsageData } from './data';
import {
  isLowRemaining,
  ledgerDisplayNames,
  ledgerDuration,
  readLedgerWindows,
  summarizeLedgerPool,
  summarizeResetGrants,
  type LedgerDuration,
  type LedgerWindow,
} from './ledger';
import styles from './ClaudeLedger.module.scss';

type Translate = ReturnType<typeof useTranslation>['t'];

const formatDuration = (t: Translate, duration: LedgerDuration) =>
  t(`quota_management.ledger_duration_${duration.key}`, {
    days: duration.days,
    hours: duration.hours,
    minutes: duration.minutes,
  });

export interface ClaudeLedgerProps {
  entries: readonly QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => ClaudeQuotaState | undefined;
  resolvedTheme: ResolvedTheme;
  canUseActions: boolean;
  resettingName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
}

export function ClaudeLedger(props: ClaudeLedgerProps) {
  const { entries, quotaFor, resolvedTheme, canUseActions, resettingName, onRefresh } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const names = ledgerDisplayNames(entries.map((entry) => entry.file));
  const pool = summarizeLedgerPool(
    entries.map((entry) => readLedgerWindows(quotaFor(entry)).weekly),
    now
  );
  const iconSrc = getAuthFileIcon('claude', resolvedTheme);
  const typeLabel = getTypeLabel(t, 'claude');
  const nextResetWhen = pool.nextReset
    ? new Date(pool.nextReset.atMs).toLocaleString(i18n.resolvedLanguage, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <section className={styles.panel} aria-label={typeLabel}>
      <header className={styles.head}>
        {iconSrc && <img src={iconSrc} alt="" className={styles.icon} />}
        <span className={styles.title}>{typeLabel}</span>
        <span className={styles.count}>{entries.length}</span>
        {pool.totalPercent > 0 && (
          <span className={styles.pool}>
            {t('quota_management.ledger_pool', {
              left: pool.leftPercent,
              total: pool.totalPercent,
            })}
          </span>
        )}
        {pool.nextReset && nextResetWhen && (
          <span className={styles.nextReset}>
            {t('quota_management.ledger_next_reset', {
              gain: pool.nextReset.gainPercent,
              when: nextResetWhen,
            })}
          </span>
        )}
      </header>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('quota_management.ledger_col_credential')}</th>
              <th scope="col">{t('quota_management.ledger_col_five_hour')}</th>
              <th scope="col">{t('quota_management.ledger_col_weekly')}</th>
              <th scope="col">{t('quota_management.ledger_col_fable')}</th>
              <th scope="col">{t('quota_management.ledger_col_resets')}</th>
              <th scope="col">
                <span className={styles.srOnly}>{t('quota_management.ledger_col_actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <ClaudeLedgerRow
                key={entry.file.name}
                entry={entry}
                name={names[index]}
                quota={quotaFor(entry)}
                now={now}
                canRefresh={canUseActions && !entry.file.disabled}
                resetting={resettingName === entry.file.name}
                onRefresh={() => onRefresh(entry)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface ClaudeLedgerRowProps {
  entry: QuotaFileEntry;
  name: string;
  quota: ClaudeQuotaState | undefined;
  now: number;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
}

function ClaudeLedgerRow(props: ClaudeLedgerRowProps) {
  const { entry, name, quota, now, canRefresh, resetting, onRefresh } = props;
  const { t } = useTranslation();
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const hasUsage = hasClaudeUsageData(quota);
  const claudeReset = useClaudeResetGrants(
    entry.file,
    status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const windows = readLedgerWindows(quota);
  const observedMs = quota?.observedAt ? Date.parse(quota.observedAt) : NaN;
  const grants = summarizeResetGrants(claudeReset.grants, now);
  const refreshLabel = t('auth_files.quota_refresh_single');
  const resetLabel = t(`claude_reset.${claudeReset.buttonLabel}`);

  return (
    <tr>
      <th scope="row" className={styles.credential}>
        <span className={styles.name} title={entry.file.name}>
          {name}
        </span>
        <span className={styles.muted}>
          {getTypeLabel(t, 'claude')}
          {Number.isFinite(observedMs) &&
            ` · ${t('quota_management.ledger_ago', {
              duration: formatDuration(t, ledgerDuration(now - observedMs, 'coarse')),
            })}`}
        </span>
      </th>
      {hasUsage ? (
        <>
          <LimitCell window={windows.fiveHour} now={now} />
          <LimitCell window={windows.weekly} now={now} />
          <LimitCell window={windows.fable} now={now} />
        </>
      ) : (
        <td colSpan={3} className={styles.stateCell}>
          {status === 'idle' ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={onRefresh}
              disabled={!canRefresh}
            >
              {t('claude_quota.idle')}
            </button>
          ) : loading ? (
            <span className={styles.muted} aria-busy="true">
              {t('claude_quota.loading')}
            </span>
          ) : (
            <span className={styles.error} role="alert">
              {t('claude_quota.load_failed', {
                message: resolveQuotaErrorMessage(
                  t,
                  quota?.errorStatus,
                  quota?.error || t('common.unknown_error')
                ),
              })}
            </span>
          )}
        </td>
      )}
      <td>
        <ul className={styles.grants}>
          {grants.map((grant) => (
            <li key={grant.kind} className={styles.grant}>
              <strong>{grant.count}</strong>
              <span>{t(`quota_management.ledger_grant_${grant.kind}`)}</span>
              {grant.expiresAtMs !== null && (
                <span
                  className={styles.expiry}
                  title={t('quota_management.ledger_grant_expires', {
                    duration: formatDuration(t, ledgerDuration(grant.expiresAtMs - now, 'fine')),
                  })}
                >
                  <IconTimer size={12} aria-hidden="true" />
                  {formatDuration(t, ledgerDuration(grant.expiresAtMs - now, 'coarse'))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </td>
      <td className={styles.actions}>
        {status !== 'idle' && (
          <button
            type="button"
            className={styles.iconButton}
            disabled={claudeReset.blocked}
            onClick={claudeReset.confirm}
            aria-label={`${resetLabel}: ${name}`}
            title={resetLabel}
          >
            <IconZap size={15} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          aria-label={`${refreshLabel}: ${name}`}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw
            size={15}
            aria-hidden="true"
            className={loading ? styles.spinning : undefined}
          />
        </button>
      </td>
    </tr>
  );
}

function LimitCell({ window, now }: { window: LedgerWindow | null; now: number }) {
  const { t } = useTranslation();
  if (!window || window.remaining === null) {
    return (
      <td>
        <span className={styles.muted}>—</span>
      </td>
    );
  }
  const low = isLowRemaining(window.remaining);
  const remaining = Math.round(window.remaining);
  return (
    <td className={low ? styles.low : undefined}>
      <span className={styles.left}>
        {t('quota_management.ledger_left', { percent: remaining })}
        {low && (
          <span className={styles.lowTag}>
            <IconAlertTriangle size={12} aria-hidden="true" />
            {t('quota_management.ledger_low')}
          </span>
        )}
      </span>
      <span className={styles.bar} aria-hidden="true">
        <span className={styles.barFill} style={{ width: `${window.remaining}%` }} />
      </span>
      {window.resetAtMs !== null && window.resetAtMs > now && (
        <span className={styles.muted}>
          {t('quota_management.ledger_resets_in', {
            duration: formatDuration(t, ledgerDuration(window.resetAtMs - now, 'fine')),
          })}
        </span>
      )}
    </td>
  );
}
