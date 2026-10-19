export function formatGreeting(name: string): string {
  return name === "" ? "Hello." : `Hello, ${name}.`;
}
