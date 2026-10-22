// PROTOTYPE, throwaway: variant C's chart: the balance through this month, then a dashed line at
// the last 7 days' rate down to zero, with the band where fewer than 7 days are left.
import { CREDITS, NOW } from "../_shared/fixtures";
import { BALANCE_AFTER_GRANT, DAILY_BALANCES, MONTH_START, RUNS_OUT_AT } from "./fixtures";
import { fmt } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;
const W = 760;
const H = 260;
const PAD = { left: 52, right: 16, top: 16, bottom: 28 };
const DAYS_SHOWN = 33;
const Y_MAX = 10_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const x = (at: Date) =>
  PAD.left +
  ((at.getTime() - MONTH_START.getTime()) / (DAYS_SHOWN * DAY_MS)) * (W - PAD.left - PAD.right);
const y = (credits: number) => PAD.top + (1 - credits / Y_MAX) * (H - PAD.top - PAD.bottom);

/** "Oct 8", in UTC like every date Mycel shows. */
const tick = (at: Date) => `${MONTHS[at.getUTCMonth()]} ${String(at.getUTCDate())}`;

export function RunwayChart() {
  const points = [
    { at: MONTH_START, balance: BALANCE_AFTER_GRANT },
    ...DAILY_BALANCES.map((d, i) => ({
      at: i === DAILY_BALANCES.length - 1 ? NOW : new Date(d.day.getTime() + DAY_MS),
      balance: d.balance,
    })),
  ];
  const line = points.map((p) => `${String(x(p.at))},${String(y(p.balance))}`).join(" ");
  const lowLine = CREDITS.lowThresholdDays * CREDITS.dailyAverage7d;
  const ticks = [0, 7, 14, 21, 28].map((d) => new Date(MONTH_START.getTime() + d * DAY_MS));
  const zeroX = x(RUNS_OUT_AT);
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      className="w-full text-foreground"
      role="img"
      aria-label={`Balance this month, from ${fmt(BALANCE_AFTER_GRANT)} on ${tick(MONTH_START)} to ${fmt(CREDITS.balance)} now, reaching zero around ${tick(RUNS_OUT_AT)}`}
    >
      <rect
        x={PAD.left}
        y={y(lowLine)}
        width={W - PAD.left - PAD.right}
        height={y(0) - y(lowLine)}
        className="fill-amber-500/10"
      />
      <text
        x={W - PAD.right - 6}
        y={y(lowLine) + 14}
        textAnchor="end"
        className="fill-amber-700 text-[11px] dark:fill-amber-400"
      >
        Under 7 days left: admins get an alert
      </text>
      {[0, 2500, 5000, 7500, 10000].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" />
          <text
            x={PAD.left - 8}
            y={y(v) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {fmt(v)}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <text
          key={t.getTime()}
          x={x(t)}
          y={H - 8}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          {tick(t)}
        </text>
      ))}
      <line
        x1={x(NOW)}
        x2={x(NOW)}
        y1={PAD.top}
        y2={y(0)}
        className="stroke-muted-foreground"
        strokeDasharray="2 3"
      />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <line
        x1={x(NOW)}
        y1={y(CREDITS.balance)}
        x2={zeroX}
        y2={y(0)}
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray="6 5"
      />
      {points.slice(1).map((p) => (
        <circle
          key={p.at.getTime()}
          cx={x(p.at)}
          cy={y(p.balance)}
          r={8}
          className="fill-transparent"
        >
          <title>{`${tick(p.at)}: ${fmt(p.balance)} credits`}</title>
        </circle>
      ))}
      <circle
        cx={x(NOW)}
        cy={y(CREDITS.balance)}
        r={4.5}
        className="fill-foreground stroke-background"
        strokeWidth={2}
      />
      <text
        x={x(NOW) + 10}
        y={y(CREDITS.balance) - 10}
        className="fill-foreground text-[12px] font-medium"
      >
        Now: {fmt(CREDITS.balance)}
      </text>
      <circle
        cx={zeroX}
        cy={y(0)}
        r={4.5}
        className="fill-destructive stroke-background"
        strokeWidth={2}
      />
      <text
        x={zeroX}
        y={y(0) - 12}
        textAnchor="middle"
        className="fill-destructive text-[12px] font-medium"
      >
        Zero, {tick(RUNS_OUT_AT)}
      </text>
      <text
        x={x(MONTH_START) + 8}
        y={y(BALANCE_AFTER_GRANT) - 8}
        className="fill-muted-foreground text-[11px]"
      >
        October allowance granted
      </text>
    </svg>
  );
}
