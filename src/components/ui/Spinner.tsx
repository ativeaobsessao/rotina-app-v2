import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-gray-400 w-6 h-6", className)} />;
}
