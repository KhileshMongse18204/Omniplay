// Inline SVG icons: a few path strings in the bundle instead of an icon font or a request per icon.
const paths = {
  home: 'M3 10.5 12 3l9 7.5V21h-6.5v-6h-5v6H3z',
  play: 'M7 4.5v15l12.5-7.5z',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
  palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1-.8-1.4-.8-2.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01M15.5 8.5h.01M8.5 15.5h.01',
  flag: 'M5 21V4h12l-2.5 4.5L17 13H5',
  heart: 'M12 20.5S3.5 15.4 3.5 9.3A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 8.5 2.1c0 6.1-8.5 11.2-8.5 11.2z',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v8h14v-8',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  close: 'M5 5l14 14M19 5 5 19',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  fire: 'M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.7 3-5.6 3.7-9.3 2.3 1.4 3.3 3.6 3.3 5.6 1-.6 1.6-1.6 1.8-2.9 2 1.6 3.2 4 3.2 6.6 0 3.6-2.6 6.2-5.5 6.2z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, filled = false, className = '' }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2.4} strokeLinecap="square" strokeLinejoin="miter">
      <path d={paths[name]} />
    </svg>
  );
}
