import { Button } from "@/components/ui/button";
import SubmitButton from "./SubmitButton";

interface FormActionsProps {
  loading: boolean;
  submitLabel: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  variant?: "default" | "danger" | "success";
  disabled?: boolean;
}

/**
 * Cancel + submit along the bottom of a form: stacked full-width on phones (submit on top),
 * right-aligned from `sm`. Spans both columns of a two-column form grid.
 */
export default function FormActions({ loading, submitLabel, onCancel, cancelLabel = "Batal", variant = "default", disabled }: FormActionsProps) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:col-span-full sm:flex-row sm:justify-end">
      {onCancel && (
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
      <SubmitButton loading={loading} variant={variant} disabled={disabled} className="sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </div>
  );
}
