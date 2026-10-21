import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { login, publicCall } from '../api';
import { Button, ErrorNote, Field, Input } from '../ui';

// Sign-in, invite acceptance and (optional) staff sign-up. Public users never see these; staff only.
// Perf: this is the only chunk a signed-out browser downloads; the dashboard code loads after sign-in.

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        <p className="text-xs font-medium text-muted">OmniPlay Admin</p>
        <h1 className="mb-5 mt-1 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, submit };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [openSignup, setOpenSignup] = useState(false);
  const { busy, error, submit } = useSubmit(() => login(email, password));
  useEffect(() => { publicCall<{ openSignup: boolean }>('/config').then((c) => setOpenSignup(c.openSignup), () => undefined); }, []);
  return (
    <Frame title="Sign in">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" variant="primary" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      {openSignup && <p className="mt-4 text-center text-[13px] text-secondary">New staff member? <Link href="/register" className="text-accent">Create an account</Link></p>}
    </Frame>
  );
}

function PasswordFields({ password, setPassword, confirm, setConfirm }: { password: string; setPassword: (v: string) => void; confirm: string; setConfirm: (v: string) => void }) {
  return (
    <>
      <Field label="Password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Field label="Repeat password"><Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
    </>
  );
}

export function AcceptInvite() {
  const token = new URLSearchParams(useSearch()).get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error("The passwords don't match");
    await publicCall('/accept-invite', { token, name, password });
    setDone(true);
  });
  if (done) return <Frame title="You're in 🎉"><p className="text-[13px] text-secondary">Your account is ready.</p><Link href="/" className="mt-4 inline-block text-accent">Sign in →</Link></Frame>;
  return (
    <Frame title="Accept your invite">
      {!token ? <ErrorNote>This link is missing its invite token. Ask the owner to send a new invite.</ErrorNote> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Your name"><Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <PasswordFields {...{ password, setPassword, confirm, setConfirm }} />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">Set password</Button>
        </form>
      )}
    </Frame>
  );
}

export function Register() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error("The passwords don't match");
    setStatus((await publicCall<{ status: string }>('/register', { email, name, password })).status);
  });
  if (status) {
    return (
      <Frame title="Account created">
        <p className="text-[13px] text-secondary">{status === 'pending' ? 'An owner needs to approve your account before you can sign in.' : 'You can sign in now.'}</p>
        <Link href="/" className="mt-4 inline-block text-accent">Go to sign in →</Link>
      </Frame>
    );
  }
  return (
    <Frame title="Create a staff account">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Work email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Name"><Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <PasswordFields {...{ password, setPassword, confirm, setConfirm }} />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" variant="primary" disabled={busy} className="w-full">Create account</Button>
      </form>
      <p className="mt-4 text-center text-[13px]"><Link href="/" className="text-accent">Back to sign in</Link></p>
    </Frame>
  );
}
