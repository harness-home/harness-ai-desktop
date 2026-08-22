// Based on shadcn/ui label (MIT).
import * as LabelPrimitive from '@radix-ui/react-label'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium leading-none text-foreground', className)}
      {...props}
    />
  )
}
