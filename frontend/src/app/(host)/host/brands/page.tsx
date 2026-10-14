"use client";

import { Tag } from "lucide-react";
import { hostApi } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import { KnowledgeText } from "@/components/BrandKnowledge";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";

const viaBadge = { backup: "Backup", event: "Event" } as const;

/** Product knowledge of the brands I'm assigned to, and of the ones I go live for soon as a backup or in an event. */
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
            action={
              brand.is_obs || brand.via !== "assigned" ? (
                <span className="flex gap-1.5">
                  {brand.via !== "assigned" && <StatusBadge tone="success">{viaBadge[brand.via]}</StatusBadge>}
                  {brand.is_obs && <StatusBadge tone="info">OBS</StatusBadge>}
                </span>
              ) : undefined
            }
          >
            <KnowledgeText text={brand.product_knowledge} />
          </Card>
        ))}
      </div>
    </div>
  );
}
