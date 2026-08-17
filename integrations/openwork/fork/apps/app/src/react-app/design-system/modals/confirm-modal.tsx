/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant?: "danger" | "warning";
  confirmButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  cancelButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function clearBodyPointerEvents() {
  if (typeof document === "undefined") return;
  // Dropdown/context menus can leave body at pointer-events:none while this
  // dialog is open, which makes the confirm button look clickable but do nothing.
  document.body.style.pointerEvents = "";
}

export function ConfirmModal(props: ConfirmModalProps) {
  const variant = props.variant ?? "warning";
  const confirmVariant = props.confirmButtonVariant ?? (variant === "danger" ? "destructive" : undefined);
  const cancelVariant = props.cancelButtonVariant ?? "outline";
  const busy = props.busy === true;

  let iconTileClass = "bg-amber-3/50 text-amber-11";
  if (variant === "danger") iconTileClass = "bg-red-3/50 text-red-11";

  useEffect(() => {
    if (!props.open) return;
    clearBodyPointerEvents();
    const timer = window.setTimeout(clearBodyPointerEvents, 0);
    return () => window.clearTimeout(timer);
  }, [props.open]);

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !busy) props.onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className={iconTileClass}>
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant={cancelVariant} disabled={busy}>
            {props.cancelLabel}
          </AlertDialogCancel>
          {/*
            Use a plain Button (not AlertDialogAction/Close) so async confirm
            can keep the dialog open until the caller finishes, matching
            RenameSessionModal. Clear stuck pointer-events before invoking.
          */}
          <Button
            type="button"
            variant={confirmVariant}
            disabled={busy}
            onClick={() => {
              clearBodyPointerEvents();
              props.onConfirm();
            }}
          >
            {props.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
