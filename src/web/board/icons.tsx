import type { ReactNode } from 'react';

// Line icons from the canvas POC: 24×24, stroked with the current text colour.

function Svg({
  size = 22,
  width = 1.7,
  children,
}: {
  size?: number;
  width?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const PenIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M15.2 5.2l3.6 3.6" />
    <path d="M17.6 2.8a2.55 2.55 0 0 1 3.6 3.6L8.4 19.2 3.5 20.5l1.3-4.9L17.6 2.8z" />
  </Svg>
);
export const EraserIcon = () => (
  <Svg>
    <path d="M7 21l-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="M5 11l9 9" />
  </Svg>
);
export const UndoIcon = () => (
  <Svg>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </Svg>
);
export const RedoIcon = () => (
  <Svg>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
  </Svg>
);
export const SettingsIcon = () => (
  <Svg size={21}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);
export const FeedbackIcon = () => (
  <Svg size={20}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
    <path d="M8.5 10.5h7" />
    <path d="M8.5 13.5h4.5" />
  </Svg>
);
export const GridIcon = () => (
  <Svg size={20}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </Svg>
);
export const ReadyIcon = () => (
  <Svg size={19}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.2 12.3l2.6 2.6 5-5.2" />
  </Svg>
);

const CHEVRONS = {
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
};
export const Chevron = ({ dir }: { dir: keyof typeof CHEVRONS }) => (
  <Svg size={18} width={2}>
    <path d={CHEVRONS[dir]} />
  </Svg>
);
