import * as React from "react";
import { cn } from "../../utils/cn";

interface BadgeProps {
  variant?: 'waiting' | 'pending' | 'confirmed' | 'attention';
  className?: string;
  children?: React.ReactNode;
}

export function Badge({ className, variant = 'waiting', children, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        {
          'bg-gray-100 text-gray-700': variant === 'waiting',
          'bg-yellow-50 text-yellow-800': variant === 'pending',
          'bg-green-50 text-green-700': variant === 'confirmed',
          'bg-red-50 text-red-700': variant === 'attention',
        },
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
