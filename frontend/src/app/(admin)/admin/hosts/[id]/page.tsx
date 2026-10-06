"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Old links to a host's page: the host now opens in a dialog on the list. */
export default function AdminHostRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/admin/hosts?host=${id}`);
  }, [id, router]);

  return <p className="text-muted">Membuka host…</p>;
}
