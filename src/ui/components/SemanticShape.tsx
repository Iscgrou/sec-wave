/**
 * Triple-Redundancy Geometric Primitives & Atomic UAX #9 BiDi Numeric Wrapper
 * Ensures no state is ever signaled by color alone (Color + Geometric Shape + Persian Label),
 * and every numeric figure is atomically isolated in <bdi dir="ltr">.
 */

import type { ReactNode } from 'react';

export type SemanticShapeKind =
  | 'circle'
  | 'triangle'
  | 'triangle-down'
  | 'diamond'
  | 'square'
  | 'hexagon'
  | 'cross'
  | 'ring'
  | 'shield';

interface SemanticShapeProps {
  readonly shape: SemanticShapeKind;
  readonly color: string;
  readonly size?: number;
  readonly className?: string;
}

export function SemanticShape({
  shape,
  color,
  size = 10,
  className = '',
}: SemanticShapeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`shrink-0 inline-block ${className}`}
    >
      {shape === 'circle' && <circle cx="6" cy="6" r="4.5" fill={color} />}
      {shape === 'ring' && (
        <circle cx="6" cy="6" r="4.2" fill="none" stroke={color} strokeWidth="2" />
      )}
      {shape === 'square' && <rect x="2" y="2" width="8" height="8" rx="1" fill={color} />}
      {shape === 'diamond' && <polygon points="6,1 11,6 6,11 1,6" fill={color} />}
      {shape === 'triangle' && <polygon points="6,1.5 11,10.5 1,10.5" fill={color} />}
      {shape === 'triangle-down' && <polygon points="6,10.5 11,1.5 1,1.5" fill={color} />}
      {shape === 'hexagon' && (
        <polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill={color} />
      )}
      {shape === 'shield' && (
        <path d="M6 1L10.5 2.8V6.2C10.5 8.8 8.6 10.4 6 11.2C3.4 10.4 1.5 8.8 1.5 6.2V2.8L6 1Z" fill={color} />
      )}
      {shape === 'cross' && (
        <path
          d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

interface LtrNumProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Mandatory atomic BiDi wrapper for every price, R-multiple, percentage, ratio, and ticker.
 */
export function LtrNum({ children, className = '' }: LtrNumProps) {
  return (
    <bdi dir="ltr" className={`num-ltr inline-block ${className}`}>
      {children}
    </bdi>
  );
}
