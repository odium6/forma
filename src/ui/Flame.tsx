import { useId } from 'react';
import './flame.css';

/**
 * Streak flame. Lit: warm animated gradient (gently flickers, honours reduced motion).
 * Unlit: a calm grey outline — a missed day never shows anything alarming.
 */
export function Flame({ size = 22, lit = true, animated = false, className = '' }: { size?: number; lit?: boolean; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className={`flame ${lit ? 'lit' : 'unlit'} ${animated && lit ? 'animated' : ''} ${className}`}
      width={size}
      height={size * 1.2}
      viewBox="0 0 40 48"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`fo${id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff5a1f" />
          <stop offset="0.55" stopColor="#ff9a1f" />
          <stop offset="1" stopColor="#ffd23f" />
        </linearGradient>
        <linearGradient id={`fi${id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffd23f" />
          <stop offset="1" stopColor="#fff6c9" />
        </linearGradient>
      </defs>
      <g className="flame-outer">
        <path
          d="M20 46c9.4 0 16-6.2 16-15.3 0-7.6-4.8-12.6-8.6-17.2-1.1 4-3.3 6.9-6.2 8.3.8-7.3-2.4-13.5-8.2-18.3.5 6.8-3.3 11.1-6.9 15.4C3 22.9 4 26.6 4 30.7 4 39.8 10.6 46 20 46Z"
          fill={lit ? `url(#fo${id})` : 'none'}
          stroke={lit ? 'none' : 'currentColor'}
          strokeWidth={lit ? 0 : 2.4}
          strokeLinejoin="round"
        />
      </g>
      {lit && (
        <g className="flame-inner">
          <path d="M20 44c4.8 0 8.2-3.2 8.2-7.8 0-4-2.5-6.6-4.6-9-.6 2.1-1.7 3.6-3.2 4.3.4-3.8-1.3-7-4.2-9.5.3 3.5-1.7 5.8-3.6 8C11.3 32.6 11.8 34.6 11.8 36.2c0 4.6 3.4 7.8 8.2 7.8Z" fill={`url(#fi${id})`} />
        </g>
      )}
    </svg>
  );
}
