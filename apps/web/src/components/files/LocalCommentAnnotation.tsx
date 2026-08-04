import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

interface LocalCommentAnnotationProps {
  kind: "draft" | "comment";
  rangeLabel: string;
  text: string;
  onCancel: () => void;
  onComment: (text: string) => void;
  onDelete: () => void;
}

export function LocalCommentAnnotation({
  kind,
  rangeLabel,
  text: savedText,
  onCancel,
  onComment,
  onDelete,
}: LocalCommentAnnotationProps) {
  const [text, setText] = useState("");

  if (kind === "comment") {
    return (
      <div
        data-file-comment-annotation
        className="group/comment flex min-w-0 items-start gap-2 px-3 py-2 font-sans text-foreground"
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5">{savedText}</p>
        <Button
          className="-my-1 -mr-1 shrink-0 text-muted-foreground"
          variant="ghost"
          size="icon-xs"
          aria-label="Delete comment"
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      data-file-comment-annotation
      className="px-3 py-2 font-sans text-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Textarea
        autoFocus
        unstyled
        className="relative inline-flex w-full rounded-md border border-border/50 bg-background/20 font-sans text-foreground transition-colors focus-within:border-border/70 [&_[data-slot=textarea]]:min-h-12 [&_[data-slot=textarea]]:cursor-text [&_[data-slot=textarea]]:px-2.5 [&_[data-slot=textarea]]:py-1.5 [&_[data-slot=textarea]]:font-sans [&_[data-slot=textarea]]:text-xs [&_[data-slot=textarea]]:leading-5 max-sm:[&_[data-slot=textarea]]:min-h-12"
        size="sm"
        value={text}
        placeholder="Add a comment…"
        aria-label={`Comment on lines ${rangeLabel}`}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && text.trim()) {
            event.preventDefault();
            onComment(text.trim());
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-1">
        <span className="mr-auto text-[10px] text-muted-foreground/70">⌘/Ctrl Enter to send</span>
        <Button
          className="text-muted-foreground hover:text-foreground"
          variant="ghost"
          size="xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button size="xs" disabled={!text.trim()} onClick={() => onComment(text.trim())}>
          Comment
        </Button>
      </div>
    </div>
  );
}
