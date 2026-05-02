import * as React from "react"

import { cn } from "@/lib/utils"

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Tooltip({
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="tooltip" className="group/tooltip relative inline-flex" {...props}>
      {children}
    </span>
  )
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }) {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      ...props,
      "data-slot": "tooltip-trigger",
    } as React.HTMLAttributes<HTMLElement>)
  }

  return (
    <span data-slot="tooltip-trigger" {...props}>
      {children}
    </span>
  )
}

function TooltipContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { sideOffset?: number; side?: string }) {
  return (
    <span
      data-slot="tooltip-content"
      className={cn(
        "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-64 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg group-hover/tooltip:block group-focus-within/tooltip:block",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
