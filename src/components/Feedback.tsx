export function Feedback({ message, error = false }: { message: string; error?: boolean }) {
  return <p role={error ? 'alert' : 'status'} className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`}>{message}</p>
}
