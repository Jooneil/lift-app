/**
 * Lift mascot — drop-in React component.
 *
 * Body is identical across all expressions; only the face features swap.
 * Pure SVG, no dependencies. Works in React Native via react-native-svg
 * with a tiny shim (see README).
 *
 * Usage:
 *   <Mascot expression="happy" size={120} />
 */

import * as React from 'react';

export const MASCOT_EXPRESSIONS = [
  'happy',
  'wink',
  'determined',
  'excited',
  'focused',
  'tired',
  'surprised',
  'smug',
  'sleeping',
  'victorious',
] as const;

export type MascotExpression = (typeof MASCOT_EXPRESSIONS)[number];

export const MASCOT_EXPRESSION_LABELS: Record<MascotExpression, string> = {
  happy: 'Happy',
  wink: 'Wink',
  determined: 'Determined',
  excited: 'Excited',
  focused: 'Focused',
  tired: 'Tired',
  surprised: 'Surprised',
  smug: 'Smug',
  sleeping: 'Sleeping',
  victorious: 'Victorious',
};

const EYE = '#A9DCFF';
const BLUE = '#4778FF';

interface MascotProps {
  expression?: MascotExpression;
  size?: number;
  className?: string;
  /** Stable id suffix — required if you render >1 mascot on the same page,
   *  otherwise the gradient defs collide. Defaults to a random string. */
  idSuffix?: string;
}

export function Mascot({
  expression = 'happy',
  size = 160,
  className,
  idSuffix,
}: MascotProps) {
  const uid = React.useMemo(
    () => idSuffix ?? Math.random().toString(36).slice(2, 9),
    [idSuffix],
  );
  const id = (n: string) => `mascot-${n}-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={`Mascot — ${expression}`}
    >
      <defs>
        <linearGradient id={id('crest')} x1="512" y1="126" x2="512" y2="392" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4778FF" />
          <stop offset="1" stopColor="#2155E8" />
        </linearGradient>
        <linearGradient id={id('side')} x1="167" y1="393" x2="276" y2="654" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4E80FF" />
          <stop offset="1" stopColor="#244CD8" />
        </linearGradient>
        <linearGradient id={id('face')} x1="512" y1="426" x2="512" y2="724" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#101B41" />
          <stop offset="1" stopColor="#08122F" />
        </linearGradient>
        <linearGradient id={id('shell')} x1="512" y1="242" x2="512" y2="788" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.72" stopColor="#F7F9FF" />
          <stop offset="1" stopColor="#EDF1FA" />
        </linearGradient>
        <filter id={id('shadow')} x="210" y="766" width="604" height="94" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>

      {/* shadow */}
      <ellipse cx="512" cy="813" rx="260" ry="24" fill="#7B87A8" opacity="0.16" filter={`url(#${id('shadow')})`} />

      {/* side panels (headphones) */}
      <path d="M206 395 C176 397 154 421 154 452 V585 C154 616 176 641 206 645 L266 652 V388 L206 395Z" fill={`url(#${id('side')})`} stroke="#08122F" strokeWidth="18" strokeLinejoin="round" />
      <path d="M818 395 C848 397 870 421 870 452 V585 C870 616 848 641 818 645 L758 652 V388 L818 395Z" fill={`url(#${id('side')})`} stroke="#08122F" strokeWidth="18" strokeLinejoin="round" />
      <path d="M184 454 L248 505" stroke="#78A0FF" strokeWidth="18" strokeLinecap="round" opacity="0.35" />
      <path d="M840 454 L776 505" stroke="#78A0FF" strokeWidth="18" strokeLinecap="round" opacity="0.35" />

      {/* crest */}
      <path d="M317 360 L317 275 L393 337 L512 160 L631 337 L707 275 L707 360 C661 327 592 307 512 307 C432 307 363 327 317 360Z" fill={`url(#${id('crest')})`} />

      {/* shell */}
      <path d="M214 457 C222 346 277 252 317 268 L317 360 C363 327 432 307 512 307 C592 307 661 327 707 360 L707 268 C747 252 802 346 810 457 C846 470 868 505 867 550 C865 676 724 776 512 776 C300 776 159 676 157 550 C156 505 178 470 214 457Z" fill={`url(#${id('shell')})`} stroke="#08122F" strokeWidth="18" strokeLinejoin="round" />

      {/* shell smile highlight */}
      <path d="M236 626 C292 714 388 750 512 750 C636 750 732 714 788 626" stroke="#D9E1F2" strokeWidth="22" strokeLinecap="round" opacity="0.65" />

      {/* side arrows */}
      <path d="M227 443 L270 478 L244 500" stroke="#4E80FF" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M797 443 L754 478 L780 500" stroke="#4E80FF" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />

      {/* face panel */}
      <path d="M279 489 C329 460 394 484 443 494 C484 503 540 503 581 494 C630 484 695 460 745 489 C775 507 787 544 781 592 C768 695 649 724 512 724 C375 724 256 695 243 592 C237 544 249 507 279 489Z" fill={`url(#${id('face')})`} />

      {/* dumbbell */}
      <g stroke={BLUE} strokeWidth="16" strokeLinecap="round">
        <path d="M468 390 V434" />
        <path d="M556 390 V434" />
        <path d="M487 412 H537" />
        <path d="M449 399 V425" />
        <path d="M575 399 V425" />
      </g>

      {/* shell highlights */}
      <path d="M276 351 C250 392 238 424 232 469" stroke="#FFFFFF" strokeWidth="18" strokeLinecap="round" opacity="0.42" />
      <path d="M343 283 L343 342" stroke="#FFFFFF" strokeWidth="14" strokeLinecap="round" opacity="0.5" />
      <path d="M681 283 L681 342" stroke="#FFFFFF" strokeWidth="14" strokeLinecap="round" opacity="0.5" />

      {/* face features (per expression) */}
      <Face expression={expression} />
    </svg>
  );
}

function Sparkle({ cx, cy, scale = 1 }: { cx: number; cy: number; scale?: number }) {
  return (
    <g transform={`translate(${cx},${cy}) scale(${scale})`} fill={EYE}>
      <path d="M 0 -42 L 12 -12 L 42 0 L 12 12 L 0 42 L -12 12 L -42 0 L -12 -12 Z" />
      <circle cx="0" cy="0" r="9" fill="#ffffff" />
    </g>
  );
}

function Face({ expression }: { expression: MascotExpression }) {
  switch (expression) {
    case 'happy':
      return (
        <g stroke={EYE} fill="none" strokeLinecap="round">
          <path d="M 352 583 C 366 553 407 553 421 583" strokeWidth="20" />
          <path d="M 603 583 C 617 553 658 553 672 583" strokeWidth="20" />
          <path d="M 462 643 C 489 664 535 664 562 643" strokeWidth="18" />
        </g>
      );
    case 'wink':
      return (
        <g>
          <path d="M 352 583 C 366 553 407 553 421 583" stroke={EYE} fill="none" strokeWidth="20" strokeLinecap="round" />
          <circle cx="637" cy="578" r="20" fill={EYE} />
          <path d="M 470 643 C 495 658 540 658 560 638" stroke={EYE} fill="none" strokeWidth="18" strokeLinecap="round" />
        </g>
      );
    case 'determined':
      return (
        <g stroke={EYE} fill="none" strokeLinecap="round">
          <path d="M 340 558 L 432 590" strokeWidth="18" />
          <path d="M 684 558 L 592 590" strokeWidth="18" />
          <circle cx="392" cy="600" r="12" fill={EYE} />
          <circle cx="632" cy="600" r="12" fill={EYE} />
          <line x1="468" y1="655" x2="556" y2="655" strokeWidth="18" />
        </g>
      );
    case 'excited':
      return (
        <g>
          <Sparkle cx={387} cy={583} scale={0.95} />
          <Sparkle cx={637} cy={583} scale={0.95} />
          <path d="M 432 633 Q 512 720 592 633 Q 512 690 432 633 Z" fill={EYE} />
        </g>
      );
    case 'focused':
      return (
        <g stroke={EYE} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <line x1="346" y1="583" x2="430" y2="583" strokeWidth="18" />
          <line x1="594" y1="583" x2="678" y2="583" strokeWidth="18" />
          <path d="M 442 654 L 462 638 L 482 654 L 502 638 L 522 654 L 542 638 L 562 654 L 582 638" strokeWidth="14" />
        </g>
      );
    case 'tired':
      return (
        <g>
          <g stroke={EYE} fill="none" strokeLinecap="round">
            <path d="M 352 583 C 366 615 407 615 421 583" strokeWidth="20" />
            <path d="M 603 583 C 617 615 658 615 672 583" strokeWidth="20" />
          </g>
          <ellipse cx="512" cy="660" rx="18" ry="22" fill={EYE} />
        </g>
      );
    case 'surprised':
      return (
        <g>
          <circle cx="387" cy="583" r="28" fill={EYE} />
          <circle cx="637" cy="583" r="28" fill={EYE} />
          <ellipse cx="512" cy="657" rx="22" ry="28" fill={EYE} />
        </g>
      );
    case 'smug':
      return (
        <g stroke={EYE} fill="none" strokeLinecap="round">
          <line x1="594" y1="528" x2="678" y2="544" strokeWidth="16" />
          <path d="M 352 583 C 366 558 407 558 421 583" strokeWidth="20" />
          <path d="M 603 583 C 617 558 658 558 672 583" strokeWidth="20" />
          <path d="M 462 658 Q 510 644 562 624" strokeWidth="18" />
        </g>
      );
    case 'sleeping':
      return (
        <g>
          <g stroke={EYE} fill="none" strokeLinecap="round">
            <path d="M 352 583 C 366 615 407 615 421 583" strokeWidth="20" />
            <path d="M 603 583 C 617 615 658 615 672 583" strokeWidth="20" />
            <path d="M 472 650 Q 512 668 552 650" strokeWidth="16" />
          </g>
          <g fill={EYE} fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontWeight={700} fontStyle="italic">
            <text x="700" y="530" fontSize="68">z</text>
            <text x="754" y="466" fontSize="52">z</text>
            <text x="794" y="412" fontSize="40">z</text>
          </g>
        </g>
      );
    case 'victorious':
      return (
        <g>
          <Sparkle cx={387} cy={583} scale={1} />
          <Sparkle cx={637} cy={583} scale={1} />
          <path d="M 410 630 Q 512 740 614 630 Q 512 705 410 630 Z" fill={EYE} />
          <path d="M 472 690 Q 512 720 552 690 Q 552 706 512 710 Q 472 706 472 690 Z" fill="#FF9AB4" />
        </g>
      );
  }
}

export default Mascot;
