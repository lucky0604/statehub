import { LoginForm } from "@/components/login-form";

/**
 * /login — public route. Auth layout (no AppShell chrome).
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.8
 */
export default function LoginPage() {
  return <LoginForm />;
}
