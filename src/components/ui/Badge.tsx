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
          'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300': variant === 'waiting',
          'bg-yellow-50 text-yellow-800 dark:bg-amber-950/60 dark:text-amber-300': variant === 'pending',
          'bg-green-50 text-green-700 dark:bg-emerald-950/60 dark:text-emerald-300': variant === 'confirmed',
          'bg-red-50 text-red-700 dark:bg-rose-950/60 dark:text-rose-300': variant === 'attention',
        },
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
