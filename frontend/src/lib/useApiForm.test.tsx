import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { formValue, useApiForm } from "./useApiForm";

const invalid = (errors: Record<string, string[]>) => new ApiError(422, Object.values(errors)[0][0], { message: Object.values(errors)[0][0], errors });

function Form({ submit, shown }: { submit: (data: FormData) => Promise<unknown>; shown?: string[] }) {
  const { errors, error, handleSubmit } = useApiForm(submit, () => {}, shown);
  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <input name="name" aria-label="Nama" defaultValue="Ayu" />
      {errors.name && <p data-testid="name-error">{errors.name}</p>}
      {errors.duration_hours && <p data-testid="duration-error">{errors.duration_hours}</p>}
      <button type="submit">Simpan</button>
    </form>
  );
}

describe("useApiForm", () => {
  it("shows a validation error the form has no field for", async () => {
    render(<Form submit={() => Promise.reject(invalid({ changes: ["Tidak ada perubahan dibanding data yang tersimpan."] }))} />);
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Tidak ada perubahan dibanding data yang tersimpan.");
  });

  it("puts a field's error next to it only", async () => {
    render(<Form submit={() => Promise.reject(invalid({ name: ["Nama terlalu panjang."] }))} />);
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect((await screen.findByTestId("name-error")).textContent).toBe("Nama terlalu panjang.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("trusts the keys a form shows for controls without a name", async () => {
    render(<Form submit={() => Promise.reject(invalid({ duration_hours: ["Durasi minimal 1 menit."] }))} shown={["duration_hours"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect((await screen.findByTestId("duration-error")).textContent).toBe("Durasi minimal 1 menit.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends the form's values", async () => {
    const submit = vi.fn(async (data: FormData) => formValue(data, "name"));
    render(<Form submit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(formValue(submit.mock.calls[0][0], "name")).toBe("Ayu");
  });
});
