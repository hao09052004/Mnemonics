// Stub kept for tests that referenced it from the old shell.
interface Props {
  initials: string;
  email: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DashboardUserMenu({ initials }: Props) {
  return <span className="avatar" aria-label="Account">{initials}</span>;
}