export function KebabIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}

export function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="2" x2="12" y2="12" />
      <line x1="12" y1="2" x2="2" y2="12" />
    </svg>
  );
}

export function TimerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="9" r="6" />
      <path d="M8 6v3l2 1.5" />
      <path d="M6 1h4" />
      <path d="M8 1v2" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="10 4 6 8 10 12" />
    </svg>
  );
}

export function FlameIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 23C8.13 23 5 19.87 5 16c0-2.76 1.38-5.2 3.5-6.68.07 1.13.46 2.19 1.13 3.08A4.98 4.98 0 0 1 10 10c0-2.34 1.6-4.3 3.78-4.84C13.17 6.5 13 7.73 13 9c0 1.8.89 3.39 2.25 4.36A4.97 4.97 0 0 1 17 16c0 3.87-3.13 7-5 7zm2.67-9.36C13.96 12.9 13 11.55 13 10c0-.41.07-.81.18-1.18C11.88 9.61 11 10.7 11 12c0 .73.25 1.4.66 1.93A2.99 2.99 0 0 0 12 16a3 3 0 0 0 3-3c0-.48-.12-.93-.33-1.36z" />
    </svg>
  );
}
