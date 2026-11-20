/** FORMA brand mark: an "F" whose upper arm ends in a separate point — the goal. */
export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id="fm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14703f" />
          <stop offset="1" stopColor="#082f1e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#fm-bg)" />
      <g fill="#cdf55c">
        <rect x="158" y="150" width="56" height="212" rx="28" />
        <rect x="158" y="150" width="128" height="56" rx="28" />
        <rect x="158" y="246" width="100" height="52" rx="26" />
        <circle cx="326" cy="178" r="28" />
      </g>
    </svg>
  );
}

/** Mark + wordmark; the wordmark follows the text colour, so it adapts to light and dark themes. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo" style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.36 }}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 720, letterSpacing: '0.16em', fontSize: size * 0.56, lineHeight: 1 }}>FORMA</span>
    </span>
  );
}
