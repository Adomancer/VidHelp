"use client";

import { useState } from "react";
import { errorMessage, operatorApi, type Assignment, type AssignmentStatus, type BrandSummary } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";

interface AssignmentEditorProps {
  hostId: string;
  assignments: Assignment[];
  brands: BrandSummary[];
  onChanged: () => void;
}

/** Add a host to brands, pick the brand leader, and deactivate/ban assignments. */
export default function AssignmentEditor({ hostId, assignments, brands, onChanged }: AssignmentEditorProps) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandId, setBrandId] = useState("");

  const assignedIds = new Set(assignments.map((assignment) => assignment.brand_id));
  const available = brands.filter((brand) => brand.status === "active" && !assignedIds.has(brand.id));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <FormAlert tone="error">{error}</FormAlert>}

      {assignments.length === 0 && <p className="text-sm text-muted">Belum ditugaskan ke brand mana pun.</p>}

      <ul className="space-y-2">
        {assignments.map((assignment) => (
          <li key={assignment.id} className="flex flex-wrap items-center gap-3 bg-surface-2 rounded-lg px-3 py-2">
            <span className="flex-1 min-w-32 text-heading">{assignment.brand.name}</span>

            <label className="flex items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                checked={assignment.is_leader}
                disabled={busy || assignment.status !== "active"}
                onChange={(event) => run(() => operatorApi.updateAssignment(token, assignment.id, { is_leader: event.target.checked }))}
                className="accent-primary"
              />
              Leader
            </label>

            <select
              value={assignment.status}
              disabled={busy}
              onChange={(event) =>
                run(() => operatorApi.updateAssignment(token, assignment.id, { status: event.target.value as AssignmentStatus }))
              }
              aria-label={`Status di ${assignment.brand.name}`}
              className="bg-surface border border-stroke-strong rounded-md px-2 py-1 text-sm text-heading"
            >
              <option value="active">aktif</option>
              <option value="inactive">nonaktif</option>
              <option value="banned">diblokir</option>
            </select>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="flex gap-2">
          <select
            value={brandId}
            onChange={(event) => setBrandId(event.target.value)}
            aria-label="Brand yang ditambahkan"
            className="flex-1 bg-surface border border-stroke-strong rounded-md px-2 py-1.5 text-sm text-heading"
          >
            <option value="">Tambahkan ke brand…</option>
            {available.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !brandId}
            onClick={() => run(() => operatorApi.assign(token, { host_id: hostId, brand_id: brandId }).then(() => setBrandId("")))}
            className="px-3 py-1.5 rounded-md bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            Tambah
          </button>
        </div>
      )}
    </div>
  );
}
