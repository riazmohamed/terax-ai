import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";

export type DeleteTarget = {
  path: string;
  name: string;
  isDir: boolean;
};

type DeleteConfirmDialogProps = {
  target: DeleteTarget | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (target: DeleteTarget) => void | Promise<void>;
};

export function DeleteConfirmDialog({
  target,
  onOpenChange,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const itemKind = target?.isDir ? "folder" : "file";
  const iconUrl = target
    ? target.isDir
      ? folderIconUrl(target.name, false)
      : fileIconUrl(target.name)
    : null;

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent
        size="default"
        className="max-w-[420px] gap-4 rounded-2xl p-4 sm:max-w-[420px]"
      >
        <div className="flex items-start gap-3 text-left">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            <HugeiconsIcon icon={Delete02Icon} size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <AlertDialogTitle className="text-[15px] leading-5 font-semibold tracking-tight">
              Delete this {itemKind}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px] leading-5 text-muted-foreground">
              This action cannot be undone. The selected {itemKind} will be
              permanently removed from disk.
            </AlertDialogDescription>
          </div>
        </div>

        {target ? (
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-foreground">
                {target.name}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {target.path}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                target.isDir
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {itemKind}
            </span>
          </div>
        ) : null}

        <AlertDialogFooter className="gap-2 sm:justify-end">
          <AlertDialogCancel size="sm" className="h-8">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            className="h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (target) void onConfirm(target);
            }}
          >
            Yes, delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
