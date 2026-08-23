// shadcn/ui dialog on the Base UI primitive (shadcn 4.x shape, MIT).
//
// Two hard-won rules, both from real defects that locked up the whole app:
//
// 1. The scope class goes directly on Backdrop and Popup — never on a wrapper
//    element inside the Portal. A wrapper there breaks Base UI's interaction
//    layer: the popup never receives focus and dismissal stops working.
// 2. No CSS transitions/animations on Backdrop or Popup. Base UI keeps a
//    closing dialog mounted until its exit animation reports completion; when
//    that never arrives the popup stays in the DOM at opacity 0 with
//    pointer-events on — an invisible full-screen blocker over the app.
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'

/** Token scope shared by every portalled part of this plugin's UI. */
export const SCOPE = 'harness-account-scope'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className={cn(SCOPE, 'fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]')}
      />
      <DialogPrimitive.Popup
        className={cn(
          SCOPE,
          'fixed left-1/2 top-1/2 z-[61] grid w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-xl border border-border bg-background p-6 text-foreground shadow-2xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="close"
          className="absolute right-3.5 top-3.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg leading-none font-semibold text-foreground', className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-row justify-end gap-2 pt-1', className)} {...props} />
}
