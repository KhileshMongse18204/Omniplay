// Tracking tags pasted by the owner (Admin → Settings → SEO). They're non-essential, so they run only once the
// browser is idle, after the page is interactive, and never compete with the first paint.
let done = false;

export function injectScripts(head: string, body: string) {
  if (done || (!head.trim() && !body.trim())) return;
  done = true;
  const run = () => {
    // createContextualFragment makes <script> tags inside the snippet actually execute.
    if (head.trim()) document.head.append(document.createRange().createContextualFragment(head));
    if (body.trim()) document.body.append(document.createRange().createContextualFragment(body));
  };
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
