"use client";

import { BookOpen, Tag } from "lucide-react";
import { hostApi } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";

/** Shows text with its http(s) links clickable, keeping line breaks. */
function Linkified({ text }: { text: string }) {
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

/** Product knowledge of the brands I'm assigned to. */
export default function HostBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("my-brands", () => hostApi.brands(token));

  return (
    <div className="space-y-6">
      <PageHeader title="Brand saya" description="Product knowledge dari setiap brand yang kamu pegang. Baca sebelum live." />
      {brands.error && <ErrorState message={brands.error} onRetry={brands.reload} />}
      {!brands.data && !brands.error && <CardsSkeleton count={2} className="lg:grid-cols-2" />}

      {brands.data?.brands.length === 0 && (
        <Card>
          <EmptyState icon={Tag} title="Belum ada brand" description="Kamu belum ditugaskan ke brand mana pun. Operator akan menambahkannya." />
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {brands.data?.brands.map((brand) => (
          <Card
            key={brand.id}
            title={
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-brand" aria-hidden="true">
                  {brand.name.charAt(0).toUpperCase()}
                </span>
                {brand.name}
              </span>
            }
            action={brand.is_obs ? <StatusBadge tone="info">OBS</StatusBadge> : undefined}
          >
            {brand.product_knowledge ? (
              <Linkified text={brand.product_knowledge} />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <BookOpen className="size-4 shrink-0" aria-hidden="true" />
                Belum ada product knowledge. Tanyakan ke operator kamu.
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
