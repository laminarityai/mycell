// The balance through the range: solid where it happened, each grant a step up labelled with
// what it added, then dashed at the last 7 days' rate down to zero, over the band where fewer
// than 7 days would be left. The projection shows only while the range includes today.
import { formatCredits } from "../format";
import { includesNow } from "../range";
import type { Runway, SpendingSummary } from "../types";
import {
  Axes,
  axisDays,
  dayW,
  FRAME,
  type Frame,
  niceMax,
  NowLine,
  points,
  tick,
  xOf,
  yOf,
} from "./chart-kit";
import { balancePoints, dayBalances, nowDay } from "./series";

export function BalanceChart({
  summary,
  runway,
  now,
}: {
  summary: SpendingSummary;
  runway: Runway;
  now: Date;
}) {
  const pts = balancePoints(summary, now);
  const balances = dayBalances(summary, now);
  const at = nowDay(summary, now);
  const current = pts.at(-1)?.[1] ?? summary.openingBalance;
  const rate = includesNow(summary.range, now) ? runway.dailyRate : null;
  const lowTop = rate === null ? 0 : 7 * rate;
  const f: Frame = {
    ...FRAME,
    from: summary.range.from,
    days: axisDays(summary, now),
    yMax: niceMax(Math.max(...pts.map(([, balance]) => balance), lowTop)),
  };
  // Where the dashed projection ends: zero, or the axis's end if that comes first.
  const zeroDay = rate === null || current <= 0 ? null : at + current / rate;
  const endDay = zeroDay === null ? null : Math.min(zeroDay, f.days);
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="w-full overflow-visible text-foreground"
      role="img"
      aria-label={`The balance, from ${formatCredits(summary.openingBalance)} to ${formatCredits(current)}, each grant a step up${zeroDay === null || runway.zeroAt === null ? "" : `, reaching zero around ${tick(runway.zeroAt)} at this week's rate`}`}
    >
      {rate === null ? null : (
        <g>
          <rect
            x={f.pad.left}
            y={yOf(f, lowTop)}
            width={f.w - f.pad.left - f.pad.right}
            height={yOf(f, 0) - yOf(f, lowTop)}
            className="fill-amber-500/10"
          />
          <text
            x={f.w - f.pad.right - 6}
            y={yOf(f, lowTop) + 14}
            textAnchor="end"
            className="fill-amber-700 text-[11px] dark:fill-amber-400"
          >
            Under 7 days left
          </text>
        </g>
      )}
      <Axes f={f} />
      <NowLine f={f} day={at} />
      <polyline
        points={points(f, pts)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {balances.map((day, i) =>
        day.granted > 0 ? (
          <text
            key={i}
            x={xOf(f, i) + 4}
            y={yOf(f, day.start + day.granted) - 6}
            className="fill-emerald-700 text-[11px] font-medium tabular-nums dark:fill-emerald-400"
          >
            +{formatCredits(day.granted)}
          </text>
        ) : null,
      )}
      {endDay === null || rate === null ? null : (
        <line
          x1={xOf(f, at)}
          y1={yOf(f, current)}
          x2={xOf(f, endDay)}
          y2={yOf(f, current - rate * (endDay - at))}
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray="6 5"
        />
      )}
      {zeroDay !== null && zeroDay <= f.days ? (
        <g>
          <circle
            cx={xOf(f, zeroDay)}
            cy={yOf(f, 0)}
            r={4.5}
            className="fill-destructive stroke-background"
            strokeWidth={2}
          />
          <text
            x={xOf(f, zeroDay)}
            y={yOf(f, 0) - 12}
            textAnchor="middle"
            className="fill-destructive text-[12px] font-medium"
          >
            Zero
          </text>
        </g>
      ) : null}
      {balances.map((day, i) => (
        <rect
          key={i}
          x={xOf(f, i)}
          y={f.pad.top}
          width={dayW(f)}
          height={f.h - f.pad.top - f.pad.bottom}
          className="fill-transparent"
        >
          <title>
            {`${tick(summary.days[i]?.day ?? summary.range.from)}: ${formatCredits(day.end)} left, ${formatCredits(day.spent)} spent${day.granted > 0 ? `, ${formatCredits(day.granted)} granted` : ""}`}
          </title>
        </rect>
      ))}
    </svg>
  );
}
