import { useState } from 'react';
import { api, useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, notify, PageHeader, Select, Status, Table, Td, Textarea, Toggle, useAction } from '../ui';
import type { Cat } from './Links';

// Categories & subcategories (two levels): create, edit, hide, delete and reorder. Order is saved for
// every sibling in a single request.

export default function Categories() {
  const { data, error, loading, reload } = useApi<Cat[]>('/categories');
  const [editing, setEditing] = useState<Cat | 'new' | null>(null);
  const { busy, run } = useAction();
  const cats = data ?? [];
  const tops = cats.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const kids = (id: number) => cats.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);

  const move = (siblings: Cat[], index: number, dir: -1 | 1) => {
    const order = [...siblings];
    const [item] = order.splice(index, 1);
    order.splice(index + dir, 0, item);
    void run(() => api('/categories/order', { method: 'PUT', json: order.map((c, i) => ({ id: c.id, sortOrder: i })) })).then((ok) => ok && reload());
  };

  const row = (c: Cat, siblings: Cat[], i: number, child = false) => (
    <tr key={c.id} className="hover:bg-page/60">
      <Td>
        <span className={`flex items-center gap-2 ${child ? 'pl-6' : 'font-medium'}`}>
          <span className="size-3 shrink-0 rounded-sm" style={{ background: c.color }} aria-hidden="true" />
          <span aria-hidden="true">{c.icon}</span>{c.name}
        </span>
      </Td>
      <Td className="font-mono text-xs text-secondary">{c.slug}</Td>
      <Td className="tabular-nums">{c.active} <span className="text-muted">/ {c.links}</span></Td>
      <Td>{c.isVisible ? <Status tone="good">Visible</Status> : <Status tone="neutral">Hidden</Status>}</Td>
      <Td className="whitespace-nowrap">
        <Button variant="ghost" aria-label={`Move ${c.name} up`} disabled={busy || i === 0} onClick={() => move(siblings, i, -1)}>↑</Button>
        <Button variant="ghost" aria-label={`Move ${c.name} down`} disabled={busy || i === siblings.length - 1} onClick={() => move(siblings, i, 1)}>↓</Button>
      </Td>
      <Td className="whitespace-nowrap text-right">
        <Button variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
        <Button variant="ghost" className="text-critical-text"
          onClick={() => confirm(`Delete “${c.name}”?`) && run(() => api(`/categories/${c.id}`, { method: 'DELETE' }), 'Category deleted').then((ok) => ok && reload())}>
          Delete
        </Button>
      </Td>
    </tr>
  );

  return (
    <div>
      <PageHeader title="Categories" description="Two levels: top-level categories (the colour tiles and story rings) and their subcategories."
        actions={<Button variant="primary" onClick={() => setEditing('new')}>New category</Button>} />
      <ErrorNote>{error}</ErrorNote>
      <Card pad={false}>
        {data && cats.length === 0 ? <Empty>No categories yet.</Empty> : (
          <Table dim={loading} head={['Name', 'Slug', 'Active / all links', 'Visibility', 'Order', '']}>
            {tops.flatMap((t, i) => [row(t, tops, i), ...kids(t.id).map((k, j, sib) => row(k, sib, j, true))])}
          </Table>
        )}
      </Card>
      {editing && <CategoryEditor cat={editing === 'new' ? null : editing} tops={tops} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function CategoryEditor({ cat, tops, onClose, onSaved }: { cat: Cat | null; tops: Cat[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: cat?.name ?? '', slug: cat?.slug ?? '', parentId: cat?.parentId ?? null as number | null,
    icon: cat?.icon ?? '', color: cat?.color ?? '#b6ff3b', description: cat?.description ?? '', isVisible: cat?.isVisible ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (cat) await api(`/categories/${cat.id}`, { method: 'PATCH', json: form });
      else await api('/categories', { json: { ...form, slug: form.slug || undefined } });
      notify('Category saved');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={cat ? `Edit “${cat.name}”` : 'New category'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Slug" hint="Used in URLs (/c/slug). Leave empty to generate."><Input value={form.slug} pattern="[a-z0-9-]*" onChange={(e) => set('slug', e.target.value.toLowerCase())} /></Field>
        <Field label="Parent">
          <Select value={form.parentId ?? ''} onChange={(e) => set('parentId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">None (top-level)</option>
            {tops.filter((t) => t.id !== cat?.id).map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Icon (emoji)"><Input value={form.icon} maxLength={8} onChange={(e) => set('icon', e.target.value)} /></Field>
          <Field label="Colour"><input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className="h-[34px] w-14 rounded-md border border-line bg-surface" /></Field>
        </div>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} maxLength={280} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Toggle checked={form.isVisible} onChange={(v) => set('isVisible', v)} label="Visible on the site" />
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}
