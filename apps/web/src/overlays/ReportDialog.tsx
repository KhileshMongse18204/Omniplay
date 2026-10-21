import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sendReport, type Card, type Reason } from '../api';
import { toast, ui } from '../store';

// Anonymous report form built on the native <dialog> (focus trap, Esc to close and backdrop for free).
// The API rate-limits and de-duplicates; moderators see the report in the admin queue.

const REASONS: { id: Reason; label: string; hint: string }[] = [
  { id: 'dead', label: 'Dead', hint: "Doesn't load, or shows an error" },
  { id: 'wrong_link', label: 'Wrong link', hint: 'Goes somewhere else, or not what the card says' },
  { id: 'malicious', label: 'Malicious', hint: 'Malware, scams, or aggressive pop-ups' },
];

export default function ReportDialog({ card }: { card: Card }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<Reason>('dead');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { ref.current?.showModal(); }, []);
  const close = () => ui.set({ reportFor: null });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendReport(card.id, reason, note.trim());
      close();
      toast('🛠️', 'Thanks! A moderator will take a look.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} onClose={close} aria-labelledby="report-title"
      className="brut m-auto w-[min(92vw,440px)] bg-surface p-0 text-ink backdrop:bg-black/60">
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 id="report-title" className="display text-2xl">Report a problem</h2>
          <p className="mt-1 text-sm text-muted">with <b className="text-ink">{card.title}</b></p>
        </div>
        <fieldset className="space-y-2">
          <legend className="label mb-2 text-muted">What's wrong?</legend>
          {REASONS.map((r) => (
            <label key={r.id} className={`flex cursor-pointer items-start gap-3 border-2 p-3 ${reason === r.id ? 'border-line bg-surface-2' : 'border-line/30'}`}>
              <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="mt-1 accent-[var(--accent)]" />
              <span><b className="block text-sm">{r.label}</b><span className="text-xs text-muted">{r.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="label text-muted">Details (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3}
            className="mt-1 w-full border-2 border-line bg-bg p-2 text-sm outline-none focus:border-accent" />
        </label>
        {error && <p role="alert" className="text-sm font-bold text-[#ff5a5a]">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={close} className="btn">Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-accent">{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </form>
    </dialog>
  );
}
