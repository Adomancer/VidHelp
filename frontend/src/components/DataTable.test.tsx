import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import DataTable from "./DataTable";
import Pagination from "./Pagination";
import { DensityToggle, TableBulkBar, TableFilterDrawer, TruncatedCell, runWithConcurrency, useTableDensity, type BulkAction } from "./data-table";

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

interface SampleRow {
  id: string;
  name: string;
  hours: number;
}

const sampleData: SampleRow[] = [
  { id: "1", name: "Budi", hours: 10 },
  { id: "2", name: "Ani", hours: 25 },
];

const sampleColumns: ColumnDef<SampleRow>[] = [
  { accessorKey: "name", header: "Host" },
  { accessorKey: "hours", header: "Jam", meta: { align: "right" } },
];

describe("DataTable", () => {
  it("sorts columns via header clicks and formats right-aligned numeric cells with tabular-nums", async () => {
    render(<DataTable columns={sampleColumns} data={sampleData} getRowId={(row) => row.id} />);

    const headers = screen.getAllByRole("columnheader");
    expect(headers[0].getAttribute("aria-sort")).toBe("none");
    expect(headers[1].getAttribute("aria-sort")).toBe("none");
    expect(headers[1].className).toContain("text-right");

    const sortNameBtn = within(headers[0]).getByRole("button", { name: "Host" });
    await userEvent.click(sortNameBtn);
    expect(headers[0].getAttribute("aria-sort")).toBe("ascending");

    let bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]).getByText("Ani")).toBeTruthy();

    await userEvent.click(sortNameBtn);
    expect(headers[0].getAttribute("aria-sort")).toBe("descending");

    bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]).getByText("Budi")).toBeTruthy();

    const numericCells = within(bodyRows[0]).getAllByRole("cell");
    expect(numericCells[1].className).toContain("text-right");
    expect(numericCells[1].className).toContain("tabular-nums");
  });

  it("applies sticky header and sticky first column classes with and without selection", () => {
    const { rerender } = render(<DataTable columns={sampleColumns} data={sampleData} getRowId={(row) => row.id} />);

    let headers = screen.getAllByRole("columnheader");
    expect(headers[0].className).toContain("sticky");
    expect(headers[0].className).toContain("top-0");
    expect(headers[0].className).toContain("left-0");
    expect(headers[1].className).toContain("sticky");
    expect(headers[1].className).toContain("top-0");

    rerender(<DataTable columns={sampleColumns} data={sampleData} getRowId={(row) => row.id} enableRowSelection />);
    headers = screen.getAllByRole("columnheader");
    expect(headers[0].className).toContain("left-0");
    expect(headers[1].className).toContain("left-11");
  });

  it("supports comfortable/compact density toggle and persists via useTableDensity", async () => {
    function DensityHarness() {
      const [density, setDensity] = useTableDensity();
      return (
        <>
          <DensityToggle density={density} onChange={setDensity} />
          <DataTable columns={sampleColumns} data={sampleData} getRowId={(row) => row.id} density={density} />
        </>
      );
    }

    render(<DensityHarness />);

    const firstCell = screen.getAllByRole("cell")[0];
    expect(firstCell.className).toContain("py-3");

    await userEvent.click(screen.getByRole("radio", { name: "Ringkas" }));
    expect(screen.getAllByRole("cell")[0].className).toContain("py-1.5");
    expect(localStorage.getItem("vidhelp.table.density")).toBe("compact");
  });

  it("renders loading, error with retry, empty, and mobile card states", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<DataTable columns={sampleColumns} data={[]} loading />);
    expect(screen.getByLabelText("Memuat").getAttribute("aria-busy")).toBe("true");

    rerender(<DataTable columns={sampleColumns} data={[]} error="Gagal memuat" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Gagal memuat");
    await userEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<DataTable columns={sampleColumns} data={[]} empty={<p>Data kosong</p>} />);
    expect(screen.getByText("Data kosong")).toBeTruthy();

    rerender(
      <DataTable
        columns={sampleColumns}
        data={sampleData}
        getRowId={(row) => row.id}
        renderMobile={(row) => <div data-testid={`mobile-${row.id}`}>{row.name}</div>}
      />
    );
    expect(screen.getByTestId("mobile-1").textContent).toBe("Budi");
  });
});

describe("TruncatedCell & TableFilterDrawer & Pagination", () => {
  it("renders truncated cell text and fallback when empty", () => {
    render(
      <TooltipProvider>
        <TruncatedCell text="Catatan sangat panjang untuk diuji" />
        <TruncatedCell text={null} />
      </TooltipProvider>
    );

    const truncated = screen.getByText("Catatan sangat panjang untuk diuji");
    expect(truncated.className).toContain("truncate");
    expect(screen.getByText("–")).toBeTruthy();
  });

  it("opens TableFilterDrawer bottom sheet, resets filters, and closes on Terapkan", async () => {
    const onReset = vi.fn();
    render(
      <TableFilterDrawer activeCount={2} onReset={onReset}>
        <label htmlFor="brand-filter">Brand</label>
        <input id="brand-filter" defaultValue="Alpha" />
      </TableFilterDrawer>
    );

    const trigger = screen.getByRole("button", { name: /Filter/ });
    expect(trigger.textContent).toContain("2");
    await userEvent.click(trigger);

    expect(await screen.findByLabelText("Brand")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    expect(onReset).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Terapkan" }));
    expect(screen.queryByLabelText("Brand")).toBeNull();
  });

  it("renders unified Pagination range, page numbers, and page change callbacks", async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} lastPage={4} total={35} pageSize={10} unit="brand" onChange={onChange} />);

    expect(screen.getByText("Menampilkan 1–10 dari 35 brand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Halaman 1" }).getAttribute("aria-current")).toBe("page");

    await userEvent.click(screen.getByRole("button", { name: "Halaman 3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });
});

describe("runWithConcurrency & TableBulkBar", () => {
  it("caps in-flight workers at configured concurrency and clamps max concurrency to 5", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, idx) => idx);

    await runWithConcurrency(
      items,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      },
      { concurrency: 3 }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);

    let activeClamped = 0;
    let peakClamped = 0;
    await runWithConcurrency(
      items,
      async () => {
        activeClamped += 1;
        peakClamped = Math.max(peakClamped, activeClamped);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeClamped -= 1;
      },
      { concurrency: 99 }
    );
    expect(peakClamped).toBeLessThanOrEqual(5);
  });

  it("confirms selected count, summarizes partial failures, and retries only failed items", async () => {
    const failOnce = new Set(["2"]);
    const calls: string[] = [];
    const onComplete = vi.fn();

    function BulkHarness() {
      const [selected, setSelected] = useState<SampleRow[]>(sampleData);
      const actions: BulkAction<SampleRow>[] = [
        {
          id: "approve",
          label: "Setujui",
          getItemLabel: (row) => row.name,
          runItem: async (row) => {
            calls.push(row.id);
            if (failOnce.has(row.id)) {
              failOnce.delete(row.id);
              throw new ApiError(422, `Gagal memproses ${row.name}`);
            }
          },
        },
      ];

      return <TableBulkBar selectedItems={selected} actions={actions} onClear={() => setSelected([])} onComplete={onComplete} />;
    }

    render(<BulkHarness />);

    expect(screen.getByText("2 dipilih")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Setujui" }));

    expect(calls).toHaveLength(0);
    expect(screen.getByText("Setujui 2 item?")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Setujui (2)" }));

    expect(await screen.findByText("Ringkasan hasil")).toBeTruthy();
    expect(screen.getByText("1 berhasil")).toBeTruthy();
    expect(screen.getByText("1 gagal")).toBeTruthy();
    expect(screen.getByText("Gagal memproses Ani")).toBeTruthy();
    expect(calls).toEqual(["1", "2"]);

    await userEvent.click(screen.getByRole("button", { name: "Coba ulang yang gagal (1)" }));
    expect(calls).toEqual(["1", "2", "2"]);
    expect(toast.success).toHaveBeenCalledWith("2 item berhasil diproses.", expect.any(Object));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("wraps the table card with framed while keeping TableBulkBar outside the frame", async () => {
    const bulkActions: BulkAction<SampleRow>[] = [
      {
        id: "copy-list",
        label: "Salin daftar",
        confirmTitle: (count) => `Salin ${count} item?`,
        confirmLabel: "Salin",
        runBatch: vi.fn(),
      },
    ];

    render(<DataTable framed columns={sampleColumns} data={sampleData} getRowId={(row) => row.id} enableRowSelection bulkActions={bulkActions} />);

    const frame = screen.getByRole("table").closest("div.shadow-card");
    expect(frame).toBeTruthy();

    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[1]);

    const bulkBadge = screen.getByText("1 dipilih");
    expect(bulkBadge).toBeTruthy();
    expect(frame?.contains(bulkBadge)).toBe(false);
  });

  it("confirms selected count before running a runBatch bulk action and clears selection afterwards", async () => {
    const runBatch = vi.fn(async () => {});
    const onBulkDone = vi.fn();
    const bulkActions: BulkAction<SampleRow>[] = [
      {
        id: "copy-list",
        label: "Salin daftar",
        confirmTitle: (count) => `Salin ${count} host?`,
        confirmDescription: (count) => `Salin ${count} item terpilih ke clipboard.`,
        confirmLabel: "Salin",
        runBatch,
      },
    ];

    render(
      <DataTable
        framed
        columns={sampleColumns}
        data={sampleData}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={bulkActions}
        onBulkDone={onBulkDone}
      />
    );

    const [selectAll] = screen.getAllByRole("checkbox");
    await userEvent.click(selectAll);
    expect(screen.getByText("2 dipilih")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Salin daftar" }));
    expect(runBatch).not.toHaveBeenCalled();
    expect(screen.getByText("Salin 2 host?")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Salin" }));

    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(runBatch).toHaveBeenCalledWith(sampleData);
    expect(screen.queryByText("2 dipilih")).toBeNull();
    expect(onBulkDone).toHaveBeenCalledTimes(1);
  });
});
