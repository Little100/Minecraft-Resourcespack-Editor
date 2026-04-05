import React from 'react';
import { cn } from '../../utils/cn';
import { iconRegistry } from './icons';

export type IconSize = 12 | 14 | 16 | 20 | 24 | 32;

export interface IconProps {
  name: string;
  size?: IconSize;
  color?: string;
  filled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  color = 'currentColor',
  filled = false,
  className,
  style,
  label,
}) => {
  const iconPath = iconRegistry[name];

  if (!iconPath) {
    console.warn(`[MPE/UI] Icon "${name}" not found in registry`);
    return null;
  }

  const svgProps: React.SVGProps<SVGSVGElement> = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filled ? color : 'none',
    stroke: filled ? 'none' : color,
    strokeWidth: filled ? undefined : 2,
    strokeLinecap: filled ? undefined : 'round',
    strokeLinejoin: filled ? undefined : 'round',
    className: cn(className),
    style,
    role: label ? 'img' : 'presentation',
    'aria-label': label,
    'aria-hidden': label ? undefined : true,
  };

  return <svg {...svgProps}>{iconPath}</svg>;
};

Icon.displayName = 'Icon';

export function getIconNames(): string[] {
  return Object.keys(iconRegistry);
}
