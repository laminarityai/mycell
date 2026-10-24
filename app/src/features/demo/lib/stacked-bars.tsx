// A dependency-free stacked bar chart: one bar per day, one colored segment per series, and an
// optional line drawn over the bars. Each bar's <title> lists its values on hover.
export const chartColors = [
  "#479CF0",
  "#AA83ED",
  "#38C4B4",
  "#EF8DB1",
  "#F3BF57",
  "#86C8FA",
  "#CCAEF4",
  "#79DFCA",
  "#94A3B8",
];

const WIDTH = 900;
const HEIGHT = 300;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

export function StackedBars({
  label,
  days,
  series,
  line,
  lineLabel,
  format,
  highlighted,
}: {
  label: string;
  /** ISO dates, oldest first; one per bar. */
  days: string[];
  series: { name: string; values: number[] }[];
  line?: number[];
  lineLabel?: string;
  format: (value: number) => string;
  highlighted?: string | null;
}) {
  const totals = days.map((_, index) =>
    series.reduce((total, row) => total + row.values[index], 0),
  );
  const max = Math.max(1, ...totals, ...(line ?? []));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = plotWidth / days.length;
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => share * max);
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-border"
            strokeDasharray="3 3"
          />
          <text
            x={PAD.left - 6}
            y={y(tick) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {format(tick)}
          </text>
        </g>
      ))}
      {days.map((day, index) => {
        let top = PAD.top + plotHeight;
        return (
          <g key={day}>
            <title>
              {`${day}\n${series.map((row) => `${row.name}: ${format(row.values[index])}`).join("\n")}`}
            </title>
            {series.map((row, rowIndex) => {
              const height = (row.values[index] / max) * plotHeight;
              top -= height;
              return (
                <rect
                  key={row.name}
                  x={PAD.left + index * step + step * 0.14}
                  y={top}
                  width={step * 0.72}
                  height={height}
                  fill={chartColors[rowIndex % chartColors.length]}
                  opacity={highlighted && highlighted !== row.name ? 0.25 : 1}
                />
              );
            })}
            {index % labelEvery === 0 && (
              <text
                x={PAD.left + index * step + step / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      {line && (
        <polyline
          aria-label={lineLabel}
          fill="none"
          stroke="#815CE5"
          strokeWidth={1.5}
          points={line
            .map(
              (value, index) => `${String(PAD.left + index * step + step / 2)},${String(y(value))}`,
            )
            .join(" ")}
        />
      )}
    </svg>
  );
}
