"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

type TooltipRootProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

type TooltipContextValue = {
  closeTooltip: () => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
};

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

const Tooltip = ({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: TooltipRootProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  const contextValue = React.useMemo<TooltipContextValue>(
    () => ({
      closeTooltip: () => setOpen(false),
      triggerRef,
    }),
    [setOpen],
  );

  return (
    <TooltipContext.Provider value={contextValue}>
      <TooltipPrimitive.Root {...props} open={open} onOpenChange={setOpen}>
        {children}
      </TooltipPrimitive.Root>
    </TooltipContext.Provider>
  );
};

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>((props, ref) => {
  const context = React.useContext(TooltipContext);

  const setTriggerRef = React.useCallback(
    (element: React.ElementRef<typeof TooltipPrimitive.Trigger> | null) => {
      if (context) {
        context.triggerRef.current = element;
      }

      if (typeof ref === "function") {
        ref(element);
      } else if (ref) {
        ref.current = element;
      }
    },
    [context, ref],
  );

  return <TooltipPrimitive.Trigger {...props} ref={setTriggerRef} />;
});
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(
  (
    {
      className,
      sideOffset = 2,
      collisionPadding = 8,
      sticky = "always",
      onPointerDownOutside,
      onEscapeKeyDown,
      ...props
    },
    ref,
  ) => {
    const context = React.useContext(TooltipContext);

    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          {...props}
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          sticky={sticky}
          className={cn(
            "z-50 box-border max-w-[calc(100vw-1rem)] max-h-[min(80dvh,calc(100dvh-2rem),var(--radix-popper-available-height,80dvh))] overflow-y-auto overscroll-contain touch-pan-y rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-tooltip-content-transform-origin)",
            className,
          )}
          onPointerDownOutside={(event) => {
            onPointerDownOutside?.(event);
            const trigger = context?.triggerRef.current;
            const target = event.target;
            if (
              !event.defaultPrevented &&
              !(trigger && target instanceof Node && trigger.contains(target))
            ) {
              context?.closeTooltip();
            }
          }}
          onEscapeKeyDown={(event) => {
            onEscapeKeyDown?.(event);
            if (!event.defaultPrevented) {
              context?.closeTooltip();
            }
          }}
        />
      </TooltipPrimitive.Portal>
    );
  },
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
