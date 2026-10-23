"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { errorMessage, operatorApi, type Assignment, type AssignmentStatus, type BrandSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";
import { NativeSelect } from "./SelectField";

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

      {assignments.length === 0 && <p className="text-sm text-muted-foreground">Belum ditugaskan ke brand mana pun.</p>}

      <ul className={cn("divide-y divide-border overflow-hidden rounded-lg border border-border", assignments.length === 0 && "hidden")}>
        {assignments.map((assignment) => (
          <li key={assignment.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-card px-3 py-2.5">
            <span className={cn("min-w-32 flex-1 text-sm font-medium", assignment.status === "active" ? "text-foreground" : "text-muted-foreground")}>
              {assignment.brand.name}
            </span>

            <label className="flex items-center gap-2 text-sm text-body">
              <Checkbox
                checked={assignment.is_leader}
                disabled={busy || assignment.status !== "active"}
                onCheckedChange={(checked) => run(() => operatorApi.updateAssignment(token, assignment.id, { is_leader: checked === true }))}
              />
              Leader
            </label>

            <NativeSelect
              small
              wrapperClassName="w-32"
              value={assignment.status}
              disabled={busy}
              onChange={(event) => run(() => operatorApi.updateAssignment(token, assignment.id, { status: event.target.value as AssignmentStatus }))}
              aria-label={`Status di ${assignment.brand.name}`}
            >
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
              <option value="banned">Diblokir</option>
            </NativeSelect>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="flex gap-2">
          <NativeSelect
            small
            wrapperClassName="flex-1"
            value={brandId}
            onChange={(event) => setBrandId(event.target.value)}
            aria-label="Brand yang ditambahkan"
          >
            <option value="">Tambahkan ke brand…</option>
            {available.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            size="sm"
            disabled={busy || !brandId}
            onClick={() => run(() => operatorApi.assign(token, { host_id: hostId, brand_id: brandId }).then(() => setBrandId("")))}
          >
            <Plus aria-hidden="true" />
            Tambah
          </Button>
        </div>
      )}
    </div>
  );
}
