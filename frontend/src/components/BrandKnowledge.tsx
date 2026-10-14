"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { hostApi } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import ErrorState from "./ErrorState";
import { CardsSkeleton } from "./Loading";

/** Shows text with its http(s) links clickable, keeping line breaks. */
export function Linkified({ text }: { text: string }) {
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-body">
      {text.split(/(https?:\/\/\S+)/g).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline underline-offset-2 hover:no-underline">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </p>
  );
}

/** A brand's product knowledge, or a note that there is none yet. */
export function KnowledgeText({ text }: { text: string | null }) {
  return text ? (
    <Linkified text={text} />
  ) : (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <BookOpen className="size-4 shrink-0" aria-hidden="true" />
      Belum ada product knowledge. Tanyakan ke operator kamu.
    </p>
  );
}

/**
 * Opens the brand's product knowledge in a side panel, e.g. from a session about to go live.
 * `compact`: an icon-only button for tight rows.
 */
export function KnowledgeButton({ brand, compact = false, className }: { brand: { id: string; name: string }; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setOpen(true)}
        aria-label={compact ? `Product knowledge ${brand.name}` : undefined}
        title={compact ? "Product knowledge" : undefined}
        className={cn(className)}
      >
        <BookOpen aria-hidden="true" />
        {!compact && "Product knowledge"}
      </Button>
      {open && <KnowledgePanel brand={brand} onClose={() => setOpen(false)} />}
    </>
  );
}

function KnowledgePanel({ brand, onClose }: { brand: { id: string; name: string }; onClose: () => void }) {
  const { token } = useAuth();
  const knowledge = useApiData(`brand-knowledge-${brand.id}`, () => hostApi.brand(token, brand.id));

  return (
    <Dialog title={brand.name} description="Product knowledge · baca sebelum live" placement="side" size="md" onClose={onClose}>
      {knowledge.error && <ErrorState message={knowledge.error} onRetry={knowledge.reload} />}
      {!knowledge.data && !knowledge.error && <CardsSkeleton count={1} />}
      {knowledge.data && <KnowledgeText text={knowledge.data.brand.product_knowledge} />}
    </Dialog>
  );
}
