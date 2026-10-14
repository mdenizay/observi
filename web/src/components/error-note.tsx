export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
      {children}
    </p>
  )
}
