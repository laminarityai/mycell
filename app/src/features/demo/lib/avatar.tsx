import { cn } from "cn";

// Each agent gets a gradient thumbnail whose color stays the same for its name.
const gradients = [
  "from-sky-400 to-blue-600",
  "from-violet-400 to-purple-600",
  "from-emerald-400 to-teal-600",
  "from-amber-400 to-orange-600",
  "from-rose-400 to-pink-600",
  "from-cyan-400 to-sky-600",
  "from-indigo-400 to-violet-600",
  "from-lime-400 to-green-600",
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

export function AgentAvatar({
  name,
  className = "size-10 text-sm",
}: {
  name: string;
  className?: string;
}) {
  const color =
    Array.from(name, (letter) => letter.charCodeAt(0)).reduce((total, code) => total + code, 0) %
    gradients.length;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-sm select-none",
        gradients[color],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
