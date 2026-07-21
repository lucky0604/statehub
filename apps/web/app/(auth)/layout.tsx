/**
 * Auth layout — minimal chrome for /login. No AppShell, no sidebar,
 * no workspace switcher. Just the bare page so an unauthenticated
 * user can see the form.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-canvas p-4">
      {children}
    </div>
  );
}
