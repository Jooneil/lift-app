import React from 'react';

type EquipType = 'machine' | 'free_weight' | 'cable' | 'body_weight';

const PATHS: Record<EquipType, React.ReactElement> = {
  free_weight: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.75" y="4.25" width="2.5" height="7.5" rx="0.7" />
      <rect x="3.25" y="6" width="1.25" height="4" rx="0.4" />
      <rect x="11.5" y="6" width="1.25" height="4" rx="0.4" />
      <rect x="12.75" y="4.25" width="2.5" height="7.5" rx="0.7" />
      <line x1="4.5" y1="8" x2="11.5" y2="8" />
    </svg>
  ),
  machine: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="13" x2="14" y2="3.5" />
      <rect x="1.5" y="9.5" width="4.5" height="3.5" rx="0.5" />
      <rect x="11" y="2" width="3.5" height="2.5" rx="0.5" transform="rotate(-38 12.75 3.25)" />
    </svg>
  ),
  cable: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v3a3 3 0 0 0 3 3h4a2 2 0 0 1 2 2v2" />
      <rect x="10.5" y="11.5" width="3" height="2.5" rx="0.5" />
    </svg>
  ),
  body_weight: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="3.5" r="1.5" />
      <path d="M8 5.5v4M5 7.5h6M5.5 13l2.5-3.5L10.5 13" />
    </svg>
  ),
};

export const EQUIP_LABEL: Record<EquipType, string> = {
  free_weight: 'Free weight',
  machine: 'Machine',
  cable: 'Cable',
  body_weight: 'Bodyweight',
};

export default function EquipmentIcon({ type, size = 14 }: { type: EquipType; size?: number }) {
  const icon = PATHS[type];
  if (!icon) return null;
  return (
    <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {React.cloneElement(icon, { width: size, height: size } as React.SVGProps<SVGSVGElement>)}
    </span>
  );
}

export function getEquipmentType(ex: { machine: boolean; freeWeight: boolean; cable: boolean; bodyWeight: boolean }): EquipType | null {
  if (ex.machine) return 'machine';
  if (ex.freeWeight) return 'free_weight';
  if (ex.cable) return 'cable';
  if (ex.bodyWeight) return 'body_weight';
  return null;
}
