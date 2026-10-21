import { useBoot } from '../boot';

// Responsive image: AVIF first, then WebP, each with a width-based srcset so phones download a 320px file and
// desktops the 640px one. Lazy by default; the worker produced every variant at upload time.
// No image yet → a CSS placeholder (category colour + halftone + initials): zero requests.

const WIDTHS = [160, 320, 640, 960]; // keep in sync with IMAGE_WIDTHS in packages/core/src/links.ts

type Props = { image: string | null; title: string; color: string; sizes: string; eager?: boolean };

export function Img({ image, title, color, sizes, eager = false }: Props) {
  const { site } = useBoot();
  if (!image || !site.mediaUrl) return <Placeholder title={title} color={color} />;
  const set = (fmt: string) => WIDTHS.map((w) => `${site.mediaUrl}/${image}-${w}.${fmt} ${w}w`).join(', ');
  return (
    <picture>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <source type="image/webp" srcSet={set('webp')} sizes={sizes} />
      <img
        src={`${site.mediaUrl}/${image}-320.webp`} alt="" width={320} height={200}
        loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : 'auto'}
        className="absolute inset-0 size-full object-cover"
      />
    </picture>
  );
}

export function Placeholder({ title, color }: { title: string; color: string }) {
  const initials = title.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?';
  return (
    <div className="halftone absolute inset-0 grid place-items-center" style={{ backgroundColor: color }}>
      <span aria-hidden="true" className="display text-5xl text-black/85">{initials}</span>
    </div>
  );
}
