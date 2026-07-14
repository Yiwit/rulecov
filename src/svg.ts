import { interpret } from './report.js';
import type { RuleVerdict, RunReport } from './types.js';

const STYLE: Record<string, { color: string; bg: string; mark: string }> = {
  live: { color: '#0a7a0a', bg: '#0ca30c', mark: '✓' },
  dead: { color: '#b8542e', bg: '#ec835a', mark: '✕' },
  untestable: { color: '#8a6209', bg: '#fab219', mark: '?' },
};

const INK = '#0b0b0b';
const MUTED = '#898781';
const SECONDARY = '#52514e';
const HAIRLINE = '#e1e0d9';
const MAX_DOTS = 20;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dots(x: number, y: number, observed: number, total: number): string {
  const shown = Math.min(total, MAX_DOTS);
  const shownObserved = total <= MAX_DOTS ? observed : Math.round((observed / total) * shown);
  let out = '';
  for (let i = 0; i < shown; i += 1) {
    const cx = x + i * 20;
    out +=
      i < shownObserved
        ? `<circle cx="${cx}" cy="${y}" r="7" fill="${INK}"/>`
        : `<circle cx="${cx}" cy="${y}" r="7" fill="none" stroke="${MUTED}" stroke-width="2"/>`;
  }
  return out;
}

/** Render the coverage report as a self-contained, shareable SVG card. */
export function renderSvg(verdicts: RuleVerdict[], report?: RunReport): string {
  const width = 1000;
  const cardX = 40;
  const cardW = width - 80;
  const rowH = 38;
  const headerH = 118;
  const legendH = 84;

  let y = headerH;
  const cards: string[] = [];
  for (const v of verdicts) {
    const { label, meaning } = interpret(v);
    const style = STYLE[v.classification];
    const rows: Array<{ label: string; observed: number; total: number }> =
      v.classification === 'untestable'
        ? []
        : [
            { label: 'rule present', observed: v.baseline.observed, total: v.baseline.total },
            { label: 'rule removed', observed: v.ablated.observed, total: v.ablated.total },
            ...(v.conflict ? [{ label: 'conflict added', observed: v.conflict.observed, total: v.conflict.total }] : []),
          ];
    const cardH = 82 + rows.length * rowH;
    const badgeW = 24 + label.length * 8 + 18;
    let card = `<rect x="${cardX}" y="${y}" width="${cardW}" height="${cardH}" rx="12" fill="#ffffff" stroke="${HAIRLINE}"/>`;
    card += `<text x="${cardX + 24}" y="${y + 34}" font-size="16" font-weight="600" fill="${INK}">${esc(v.ruleId)}</text>`;
    card += `<rect x="${cardX + cardW - badgeW - 24}" y="${y + 16}" width="${badgeW}" height="28" rx="8" fill="${style.bg}" opacity="0.14"/>`;
    card += `<text x="${cardX + cardW - badgeW - 8}" y="${y + 35}" font-size="13" fill="${style.color}">${style.mark}</text>`;
    card += `<text x="${cardX + cardW - badgeW + 10}" y="${y + 35}" font-size="13" font-weight="600" fill="#2c2c2a">${esc(label)}</text>`;
    card += `<text x="${cardX + 24}" y="${y + 60}" font-size="13" fill="${SECONDARY}">${esc(meaning)}</text>`;
    rows.forEach((row, i) => {
      const ry = y + 88 + i * rowH;
      card += `<text x="${cardX + 24}" y="${ry + 5}" font-size="13" fill="${SECONDARY}">${esc(row.label)}</text>`;
      card += dots(cardX + 170, ry, row.observed, row.total);
      const countX = cardX + 170 + Math.min(row.total, MAX_DOTS) * 20 + 12;
      card += `<text x="${countX}" y="${ry + 5}" font-size="13" fill="${MUTED}">${row.observed}/${row.total} followed the rule</text>`;
    });
    cards.push(card);
    y += cardH + 16;
  }

  const counts = verdicts.reduce(
    (acc, v) => ((acc[v.classification] += 1), acc),
    { live: 0, dead: 0, untestable: 0 },
  );
  const sessions = report?.sessions.length ?? 0;
  const cost = report?.sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0) ?? 0;
  const meta = [
    sessions ? `${sessions} sessions` : null,
    cost > 0 ? `$${cost.toFixed(2)}` : null,
    `${counts.live} live · ${counts.dead} dead · ${counts.untestable} untestable`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const height = y + legendH;
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="rulecov coverage report">
<rect width="${width}" height="${height}" fill="#fcfcfb"/>
<text x="${cardX}" y="52" font-size="26" font-weight="600" fill="${INK}">Does behavior change when the rule is removed?</text>
<text x="${cardX}" y="82" font-size="14" fill="${SECONDARY}">rulecov report  ·  ${esc(meta)}</text>
${cards.join('\n')}
<circle cx="${cardX + 8}" cy="${y + 24}" r="7" fill="${INK}"/>
<text x="${cardX + 24}" y="${y + 29}" font-size="12" fill="${SECONDARY}">session followed the rule</text>
<circle cx="${cardX + 248}" cy="${y + 24}" r="7" fill="none" stroke="${MUTED}" stroke-width="2"/>
<text x="${cardX + 264}" y="${y + 29}" font-size="12" fill="${SECONDARY}">did not follow</text>
<text x="${cardX}" y="${y + 58}" font-size="12" fill="${MUTED}">Evidence from traces (diff, commands, commits), not from the agent's summary. Raw counts: a signal, not a statistic.</text>
</svg>
`;
}
