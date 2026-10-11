"use client";

import { Printer } from "lucide-react";
import type { SlipDetail } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "./ErrorState";
import PageHeader from "./PageHeader";
import SlipView from "./SlipView";

interface SlipPageProps {
  /** Distinct per slip and panel, so each load is its own. */
  cacheKey: string;
  load: () => Promise<{ slip: SlipDetail }>;
  back: { href: string; label: string };
}

/** One salary slip with a back link and a print button (admin, finance and host). */
export default function SlipPage({ cacheKey, load, back }: SlipPageProps) {
  const slip = useApiData(cacheKey, load);
  const data = slip.data?.slip;

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title="Slip gaji"
        description={data ? `${data.brand.name} · ${formatDate(data.period_start)} – ${formatDate(data.period_end)}` : undefined}
        actions={
          data && (
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Cetak / simpan PDF
            </Button>
          )
        }
        className="print:hidden"
      />
      {slip.error && <ErrorState message={slip.error} onRetry={slip.reload} />}
      {!data && !slip.error && <Skeleton className="mx-auto h-[28rem] max-w-2xl rounded-xl" />}
      {data && <SlipView slip={data} />}
    </div>
  );
}
