// Every date Mycel shows. The server renders in its own time zone and the browser in the
// reader's, so a time formatted for "here" differs between them (a hydration error) and means
// nothing to a reader elsewhere: it's shown in UTC, labeled so, in one fixed format. Lint bans
// formatting dates anywhere else (eslint.config.mjs).

const FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
};

const DAY: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeZone: "UTC" };

/**
 * A date such as "Oct 21, 2026, 2:05 PM UTC", or with `day` just "Oct 21, 2026" (the UTC day),
 * the same on the server and in any browser, with its exact time for machines and on hover.
 */
export function DateTime({ value, day = false }: { value: Date; day?: boolean }) {
  const iso = value.toISOString();
  return (
    <time dateTime={iso} title={iso}>
      {day
        ? value.toLocaleDateString("en-US", DAY)
        : `${value.toLocaleString("en-US", FORMAT)} UTC`}
    </time>
  );
}
