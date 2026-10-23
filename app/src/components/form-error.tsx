/** What went wrong with a form or a button's action, announced as it appears; nothing when it didn't. */
export function FormError({ message }: { message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
