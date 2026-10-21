import { useState } from 'react';
import { api, useApi, useAuth, type Role } from '../api';
import { ago, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Status, Table, Td, useAction } from '../ui';

// Staff accounts (owner only): invite by email, pick roles, approve self sign-ups, disable, reset access.
// Perf: invite emails go through the worker queue, so the request returns right away even with slow SMTP.

type Member = { id: number; email: string; name: string; role: Role; status: 'invited' | 'pending' | 'active' | 'disabled'; lastLoginAt: string | null; createdAt: string };
type Invite = { inviteUrl: string; emailed: boolean };
const statusTone = { active: 'good', invited: 'neutral', pending: 'warning', disabled: 'critical' } as const;
const ROLES: { id: Role; hint: string }[] = [
  { id: 'moderator', hint: 'Reports queue, read-only links' },
  { id: 'editor', hint: 'Links, categories, imports, analytics' },
  { id: 'owner', hint: 'Everything, including settings and staff' },
];

export default function Staff() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Member[]>('/staff');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('moderator');
  const [invite, setInvite] = useState<(Invite & { email: string }) | null>(null);
  const { busy, run } = useAction();

  const send = () => run(async () => {
    const r = await api<Invite>('/staff/invite', { json: { email, role } });
    setInvite({ ...r, email });
    setEmail('');
    reload();
  }, 'Invite created');
  const patch = (id: number, body: Record<string, unknown>, msg: string) =>
    run(() => api(`/staff/${id}`, { method: 'PATCH', json: body }), msg).then((ok) => ok && reload());
  const reinvite = (m: Member) => run(async () => {
    setInvite({ ...(await api<Invite>(`/staff/${m.id}/reinvite`, { method: 'POST' })), email: m.email });
    reload();
  }, 'New invite link created');

  return (
    <div>
      <PageHeader title="Staff" description="Visitors never sign in. Only staff accounts exist." />
      <Card title="Invite someone" className="mb-4">
        <form className="grid gap-3 md:grid-cols-[1fr_260px_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.id}: {r.hint}</option>)}
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>Send invite</Button>
        </form>
        {invite && (
          <div className="mt-3 rounded-md bg-page p-3 text-[13px]">
            <p>{invite.emailed ? `Emailed to ${invite.email}. You can also share this link` : `SMTP isn't configured, so share this link with ${invite.email} yourself`} (valid 72 hours):</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={invite.inviteUrl} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <Button onClick={() => navigator.clipboard.writeText(invite.inviteUrl)}>Copy</Button>
            </div>
          </div>
        )}
      </Card>
      <ErrorNote>{error}</ErrorNote>
      <Card pad={false}>
        <Table dim={loading} head={['Name', 'Role', 'Status', 'Last sign-in', '']}>
          {data?.map((m) => {
            const self = m.id === user?.id;
            return (
              <tr key={m.id}>
                <Td><p className="font-medium">{m.name || '—'}{self && <span className="ml-1.5 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{m.email}</p></Td>
                <Td>
                  <Select className="w-auto!" value={m.role} disabled={self || busy || m.status === 'invited'} aria-label={`Role for ${m.email}`}
                    onChange={(e) => patch(m.id, { role: e.target.value }, 'Role updated')}>
                    {ROLES.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </Select>
                </Td>
                <Td><Status tone={statusTone[m.status]}>{m.status === 'pending' ? 'awaiting approval' : m.status}</Status></Td>
                <Td className="text-secondary">{ago(m.lastLoginAt)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {!self && m.status === 'pending' && <Button variant="primary" disabled={busy} onClick={() => patch(m.id, { status: 'active' }, 'Approved')}>Approve</Button>}
                  {!self && m.status === 'active' && <Button variant="ghost" disabled={busy} onClick={() => confirm(`Disable ${m.email}? They are signed out within 15 minutes.`) && patch(m.id, { status: 'disabled' }, 'Disabled')}>Disable</Button>}
                  {!self && m.status === 'disabled' && <Button variant="ghost" disabled={busy} onClick={() => patch(m.id, { status: 'active' }, 'Re-enabled')}>Enable</Button>}
                  {!self && <Button variant="ghost" disabled={busy} onClick={() => confirm(`Send ${m.email} a new invite? Their current password stops working.`) && reinvite(m)}>{m.status === 'invited' ? 'New invite link' : 'Reset access'}</Button>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
