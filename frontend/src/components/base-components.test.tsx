import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Combobox from "./Combobox";
import SearchInput from "./SearchInput";
import SelectField from "./SelectField";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";
import { Button } from "./ui/button";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("Button", () => {
  it("uses primary Indigo accent, 44px mobile touch target, and avoids raw palette colors", () => {
    const { rerender } = render(<Button>Simpan</Button>);
    const primaryBtn = screen.getByRole("button", { name: "Simpan" });
    expect(primaryBtn.className).toContain("bg-primary");
    expect(primaryBtn.className).toContain("h-11");
    expect(primaryBtn.className).toContain("md:h-9");
    expect(primaryBtn.className).not.toContain("bg-green-");
    expect(primaryBtn.className).not.toContain("bg-red-");

    rerender(<Button variant="danger">Hapus</Button>);
    const dangerBtn = screen.getByRole("button", { name: "Hapus" });
    expect(dangerBtn.className).toContain("bg-destructive-solid");
    expect(dangerBtn.className).not.toContain("bg-red-");

    rerender(<Button variant="link">Detail</Button>);
    const linkBtn = screen.getByRole("button", { name: "Detail" });
    expect(linkBtn.className).toContain("text-brand");
  });
});

describe("StatusBadge", () => {
  it("renders subtle tinted backgrounds for all status tones and disables animate-ping on pulse", () => {
    const tones = [
      ["success", "bg-success-subtle"],
      ["warning", "bg-warning-subtle"],
      ["danger", "bg-destructive-subtle"],
      ["info", "bg-info-subtle"],
    ] as const;

    for (const [tone, expectedClass] of tones) {
      const { container, unmount } = render(
        <StatusBadge tone={tone} pulse>
          {tone}
        </StatusBadge>
      );
      const badge = screen.getByText(tone);
      expect(badge.className).toContain(expectedClass);
      expect(container.innerHTML).not.toContain("animate-ping");
      unmount();
    }
  });
});

describe("SearchInput", () => {
  it("renders a 44px clear button when populated and clears the value on click", async () => {
    function Controlled() {
      const [value, setValue] = useState("brand-a");
      return <SearchInput value={value} onChange={setValue} placeholder="Cari brand…" />;
    }

    render(<Controlled />);
    const input = screen.getByRole("searchbox", { name: "Cari brand…" }) as HTMLInputElement;
    expect(input.value).toBe("brand-a");

    const clearButton = screen.getByRole("button", { name: "Hapus pencarian" });
    expect(clearButton.className).toContain("size-11");

    await userEvent.click(clearButton);
    expect(input.value).toBe("");
    expect(screen.queryByRole("button", { name: "Hapus pencarian" })).toBeNull();
  });
});

describe("Combobox", () => {
  it("opens, filters options, selects an option, and clears when clearable", async () => {
    const onChange = vi.fn();

    function Wrapper() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <Combobox
          clearable
          placeholder="Pilih brand"
          options={[
            { value: "b1", label: "Brand Alpha", description: "Kategori fashion" },
            { value: "b2", label: "Brand Beta", description: "Kategori kecantikan" },
          ]}
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }

    render(<Wrapper />);
    await userEvent.click(screen.getByRole("combobox"));

    const searchBox = await screen.findByPlaceholderText("Ketik untuk mencari…");
    await userEvent.type(searchBox, "Beta");

    expect(screen.queryByText("Brand Alpha")).toBeNull();
    await userEvent.click(screen.getByText("Brand Beta"));
    expect(onChange).toHaveBeenLastCalledWith("b2");

    const clearBtn = screen.getByRole("button", { name: "Hapus pilihan Brand Beta" });
    expect(clearBtn.className).toContain("size-11");
    await userEvent.click(clearBtn);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("SelectField", () => {
  it("links aria-invalid and aria-describedby to the error element", () => {
    render(
      <SelectField
        label="Status"
        name="status"
        error="Status wajib dipilih."
        options={[
          { value: "", label: "Pilih status" },
          { value: "active", label: "Aktif" },
        ]}
      />
    );

    const select = screen.getByLabelText("Status");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const describedBy = select.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const errorEl = document.getElementById(describedBy!);
    expect(errorEl?.textContent).toContain("Status wajib dipilih.");
  });
});

describe("Toast notify", () => {
  it("dispatches success and error notifications via Sonner", () => {
    notify({ text: "Data disimpan" });
    expect(toast.success).toHaveBeenCalledWith("Data disimpan", expect.objectContaining({ duration: 4000 }));

    notify({ text: "Gagal menyimpan", tone: "error" });
    expect(toast.error).toHaveBeenCalledWith("Gagal menyimpan", expect.objectContaining({ duration: 4000 }));
  });
});
