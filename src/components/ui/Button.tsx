import * as React from "react";
import { cn } from "../../utils/cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'default' | 'lg' | 'sm';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 disabled:pointer-events-none disabled:opacity-50",
          {
            'bg-gray-900 text-white hover:bg-gray-800': variant === 'primary',
            'bg-gray-100 text-gray-900 hover:bg-gray-200': variant === 'secondary',
            'border border-gray-200 bg-white hover:bg-gray-100 text-gray-900': variant === 'outline',
            'hover:bg-gray-100 text-gray-900': variant === 'ghost',
            'h-12 px-6 py-3 text-base': size === 'default',
            'h-14 px-8 py-4 text-lg': size === 'lg',
            'h-9 px-4 py-2 text-sm': size === 'sm',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"
