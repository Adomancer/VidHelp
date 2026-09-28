"use client";

import { useState } from "react";
import Link from "next/link";
import { errorMessage, operatorApi, payrollApi, pointsApi, scheduleApi, type PeriodListItem, type PeriodStatus } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import DurationInput from "./DurationInput";
import FormAlert from "./FormAlert";
import SubmitButton from "./SubmitButton";

type Notice = { tone: "success" | "error"; text: string } | null;

const statusStyles: Record<PeriodStatus, [string, string]> = {
  in_progress: ["In progress", "bg-blue-500/15 text-blue-200"],
  waiting_payment: ["Ready to request", "bg-yellow-500/15 text-yellow-200"],
  requested: ["Waiting for brand", "bg-purple-500/15 text-purple-200"],
  paid: ["Paid", "bg-green-500/15 text-green-300"],
};

export function PeriodBadge({ status }: { status: PeriodStatus }) {
  const [label, style] = statusStyles[status];
  return <span className={`px-2 py-0.5 rounded-md text-xs whitespace-nowrap ${style}`}>{label}</span>;
}

/**
 * Admin payroll: payment periods per brand (lock, pay, slips) and kasbon.
 */
export default function PayrollDesk() {
  const [tab, setTab] = useState<"periods" | "kasbon">("periods");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ["periods", "Payment periods"],
            ["kasbon", "Kasbon"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-4 py-2 rounded-lg text-sm ${tab === value ? "bg-purple-600 text-white" : "bg-slate-900 text-gray-300 hover:bg-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "periods" ? <Periods /> : <Kasbon />}
    </div>
  );
}

function Periods() {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [brandId, setBrandId] = useState("");
  const periods = useApiData(`periods-${brandId}`, () => payrollApi.periods(token, brandId));
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const withoutStart = brands.data?.brands.filter((brand) => brand.status === "active" && !brand.payroll_start_date) ?? [];

  return (
    <div className="space-y-4">
      {withoutStart.length > 0 && (
        <FormAlert tone="warning">
          No payroll start date yet for {withoutStart.map((brand) => brand.name).join(", ")}. Set it on the Brands page so their hours get
          periods.
        </FormAlert>
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {periods.error && <FormAlert tone="error">{periods.error}</FormAlert>}

      <select
        value={brandId}
        onChange={(event) => {
          setBrandId(event.target.value);
          setSelected(null);
        }}
        aria-label="Brand"
        className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
      >
        <option value="">All brands</option>
        {brands.data?.brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>

      <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto ${periods.loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 font-medium">Brand · period</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Worked</th>
              <th className="px-4 py-3 font-medium">Billable</th>
              <th className="px-4 py-3 font-medium text-right">Host pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {periods.data?.periods.map((period) => (
              <PeriodRow key={period.id} period={period} selected={period.id === selected} onClick={() => setSelected(period.id === selected ? null : period.id)} />
            ))}
          </tbody>
        </table>
        {periods.data?.periods.length === 0 && <p className="px-4 py-8 text-center text-gray-400">No payment periods yet.</p>}
      </div>

      {selected && (
        <PeriodDetail
          key={selected}
          periodId={selected}
          onChanged={(text, tone = "success") => {
            setNotice({ tone, text });
            periods.reload();
          }}
        />
      )}
    </div>
  );
}

function PeriodRow({ period, selected, onClick }: { period: PeriodListItem; selected: boolean; onClick: () => void }) {
  return (
    <tr onClick={onClick} className={`cursor-pointer text-gray-200 ${selected ? "bg-purple-600/10" : "hover:bg-slate-800/50"}`}>
      <td className="px-4 py-3">
        <p className="text-white">{period.brand?.name}</p>
        <p className="text-xs text-gray-400">
          {formatDate(period.period_start)} – {formatDate(period.period_end)} · {period.hosts} host{period.hosts === 1 ? "" : "s"}
        </p>
      </td>
      <td className="px-4 py-3">
        <PeriodBadge status={period.status} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{formatDuration(period.worked_hours)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {formatDuration(period.achieved_hours)} <span className="text-xs text-gray-500">/ {period.target_hours} h</span>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">{formatRupiah(period.total_amount)}</td>
    </tr>
  );
}

function PeriodDetail({ periodId, onChanged }: { periodId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`period-${periodId}`, () => payrollApi.period(token, periodId));

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  async function download() {
    const tab = window.open("", "_blank");
    try {
      const url = await payrollApi.exportUrl(token, periodId);
      if (tab) tab.location.href = url;
    } catch (caught) {
      tab?.close();
      onChanged(errorMessage(caught), "error");
    }
  }

  if (detail.error) return <FormAlert tone="error">{detail.error}</FormAlert>;
  if (!detail.data) return <p className="text-gray-400">Loading…</p>;
  const { period, summary, hosts, adjustments, slips } = detail.data;
  const locked = period.status === "requested" || period.status === "paid";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg text-white font-medium">
              {period.brand?.name} · {formatDate(period.period_start)} – {formatDate(period.period_end)}
            </p>
            <PeriodBadge status={period.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            {period.status === "waiting_payment" && (
              <button
                type="button"
                onClick={() => confirm("Lock this period and request payment? Hours and rates are frozen.") && act(() => payrollApi.requestPayment(token, period.id))}
                className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500"
              >
                Request payment
              </button>
            )}
            {locked && (
              <button type="button" onClick={download} className="px-3 py-1.5 rounded-lg border border-slate-700 text-gray-300 text-sm hover:bg-slate-800">
                Brand report (CSV)
              </button>
            )}
            {period.status === "requested" && (
              <button
                type="button"
                onClick={() => confirm("The brand has paid? Salary slips are created and kasbon is deducted.") && act(() => payrollApi.markPaid(token, period.id))}
                className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-500"
              >
                Mark as paid
              </button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Target" value={`${summary.target_hours} h`} />
          <Stat label="Worked (all hosts)" value={formatDuration(summary.worked_hours)} />
          <Stat label="Carried in" value={formatDuration(summary.carried_in_hours)} />
          <Stat label="Billable to brand" value={formatDuration(summary.achieved_hours)} />
          <Stat label="Carried to next period" value={formatDuration(summary.carried_out_hours)} />
          <Stat label="Host pay" value={formatRupiah(summary.total_amount)} />
        </dl>
        {period.status === "in_progress" && <p className="text-xs text-gray-400">Pay is an estimate at today&apos;s rates until payment is requested.</p>}
      </Card>

      <Card title="Hosts">
        {hosts.length === 0 && <p className="text-sm text-gray-400">No approved hours yet.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {hosts.map((host) => (
                <tr key={host.host_id} className="text-gray-200">
                  <td className="py-2 text-white">{host.name}</td>
                  <td className="py-2">
                    {host.session_count} session{host.session_count === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 whitespace-nowrap">{formatDuration(host.hours)}</td>
                  <td className="py-2 whitespace-nowrap text-gray-400">× {formatRupiah(host.rate_per_hour)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {formatRupiah(host.amount)}
                    {host.estimate && <span className="text-xs text-gray-500"> est.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Adjustments" description="Add or remove time for a host, e.g. a live cut short by an outage.">
        {adjustments.length === 0 && <p className="text-sm text-gray-400">None.</p>}
        <ul className="space-y-2">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-800 px-3 py-2 text-sm">
              <span className="text-white">{adjustment.host.user.name}</span>
              <span className={adjustment.hours_added < 0 ? "text-red-300" : "text-green-300"}>
                {adjustment.hours_added < 0 ? "−" : "+"}
                {formatDuration(Math.abs(adjustment.hours_added))}
                {adjustment.sessions_added !== 0 && `, ${adjustment.sessions_added > 0 ? "+" : ""}${adjustment.sessions_added} session(s)`}
              </span>
              <span className="flex-1 min-w-32 text-gray-400">{adjustment.notes}</span>
              {!locked && (
                <button type="button" onClick={() => act(() => payrollApi.removeAdjustment(token, adjustment.id))} className="text-xs text-red-300 hover:text-red-200">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {!locked && <AdjustmentForm periodId={period.id} brandId={period.brand_id} onDone={(message) => act(async () => ({ message }))} />}
      </Card>

      {slips.length > 0 && (
        <Card title="Salary slips">
          <ul className="space-y-2">
            {slips.map((slip) => (
              <li key={slip.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-800 px-3 py-2 text-sm">
                <span className="flex-1 text-white">{slip.host?.user.name}</span>
                <span className="text-gray-400">
                  {formatRupiah(slip.gross_amount)}
                  {slip.advance_deduction > 0 && ` − ${formatRupiah(slip.advance_deduction)} kasbon`}
                </span>
                <span className="font-medium text-green-300">{formatRupiah(slip.net_amount)}</span>
                <Link href={`/admin/payroll/slips/${slip.id}`} className="text-xs text-purple-300 hover:text-white">
                  View
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-white">{value}</dd>
    </div>
  );
}

function AdjustmentForm({ periodId, brandId, onDone }: { periodId: string; brandId: string; onDone: (message: string) => void }) {
  const { token } = useAuth();
  const hosts = useApiData(`brand-hosts-${brandId}`, () => scheduleApi.brandHosts(token, brandId));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hours, setHours] = useState(1);
  const input = "px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white";

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      payrollApi.addAdjustment(token, periodId, {
        host_id: formValue(data, "host_id"),
        sessions_added: direction * Number(formValue(data, "sessions") || 0),
        hours_added: direction * hours,
        notes: formValue(data, "notes"),
      }),
    ({ message }, form) => {
      form.reset();
      onDone(message);
    }
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 border-t border-slate-800 pt-3" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Host</span>
        <select name="host_id" className={`${input} w-full`}>
          {hosts.data?.assignments.map((assignment) => (
            <option key={assignment.host_id} value={assignment.host_id}>
              {assignment.host.user.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Add or remove</span>
        <select value={direction} onChange={(event) => setDirection(Number(event.target.value) as 1 | -1)} className={`${input} w-full`}>
          <option value={1}>Add time</option>
          <option value={-1}>Remove time</option>
        </select>
      </label>
      <DurationInput label="Time" hours={hours} onChange={setHours} error={errors.hours_added} compact />
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Sessions (optional)</span>
        <input name="sessions" type="number" min={0} max={50} defaultValue={0} className={`${input} w-24`} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-xs text-gray-400">Reason</span>
        <input name="notes" maxLength={255} className={`${input} w-full`} />
        {errors.notes && <span className="block text-xs text-red-300">{errors.notes}</span>}
      </label>
      <div className="w-44">
        <SubmitButton loading={loading}>Save adjustment</SubmitButton>
      </div>
    </form>
  );
}

const advanceTypes = { early_payment: "Early payment", loan: "Loan" } as const;

function Kasbon() {
  const { token } = useAuth();
  const [status, setStatus] = useState<"open" | "paid" | "">("open");
  const advances = useApiData(`advances-${status}`, () => payrollApi.advances(token, status));
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);

  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    advances.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          aria-label="Status"
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
        >
          <option value="open">Still being paid back</option>
          <option value="paid">Paid back</option>
          <option value="">All</option>
        </select>
        <button type="button" onClick={() => setCreating(!creating)} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500">
          {creating ? "Close" : "Record kasbon"}
        </button>
      </div>

      {creating && (
        <AdvanceForm
          onDone={(message) => {
            setCreating(false);
            act(async () => ({ message }));
          }}
        />
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {advances.error && <FormAlert tone="error">{advances.error}</FormAlert>}

      {advances.data?.advances.length === 0 && (
        <Card>
          <p className="text-sm text-gray-400">No kasbon here.</p>
        </Card>
      )}
      {advances.data?.advances.map((advance) => {
        const paidCount = advance.installments.filter((installment) => installment.status === "deducted").length;

        return (
          <Card key={advance.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-white font-medium">
                  {advance.host.user.name} · {formatRupiah(advance.total_amount)}
                </p>
                <p className="text-xs text-gray-400">
                  {advanceTypes[advance.type]} · {formatDate(advance.requested_at)}
                  {advance.brand ? ` · ${advance.brand.name}` : ""}
                  {advance.notes ? ` · ${advance.notes}` : ""}
                </p>
              </div>
              <span className="text-sm text-gray-300">
                {paidCount}/{advance.installment_count} installments · {formatRupiah(advance.total_amount - advance.deducted_amount)} left
              </span>
            </div>
            <div className="flex gap-1">
              {advance.installments.map((installment) => (
                <span
                  key={installment.id}
                  title={`${installment.seq}: ${formatRupiah(installment.amount)}`}
                  className={`h-2 flex-1 rounded-full ${installment.status === "deducted" ? "bg-green-500" : "bg-slate-700"}`}
                />
              ))}
            </div>
            {paidCount === 0 && (
              <button
                type="button"
                onClick={() => confirm("Remove this kasbon?") && act(() => payrollApi.removeAdvance(token, advance.id))}
                className="text-xs text-red-300 hover:text-red-200"
              >
                Remove (recorded by mistake)
              </button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function AdvanceForm({ onDone }: { onDone: (message: string) => void }) {
  const { token } = useAuth();
  const hosts = useApiData("points-hosts-all", () => pointsApi.hosts(token));
  const input = "w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white";

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      payrollApi.createAdvance(token, {
        host_id: formValue(data, "host_id"),
        type: formValue(data, "type") as "early_payment" | "loan",
        total_amount: Number(formValue(data, "total_amount")),
        installment_count: Number(formValue(data, "installment_count")),
        notes: formValue(data, "notes") || null,
      }),
    ({ message }) => onDone(message)
  );

  return (
    <Card title="Record kasbon" description="Paid back in equal installments from the host's next salary slips (any brand).">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <label className="space-y-1">
          <span className="block text-xs text-gray-400">Host</span>
          <select name="host_id" className={input}>
            {hosts.data?.hosts.map((host) => (
              <option key={host.host_id} value={host.host_id}>
                {host.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-gray-400">Type</span>
          <select name="type" className={input}>
            <option value="loan">Loan</option>
            <option value="early_payment">Early payment</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-gray-400">Amount (Rp)</span>
          <input name="total_amount" type="number" min={1000} step={1000} className={input} />
          {errors.total_amount && <span className="block text-xs text-red-300">{errors.total_amount}</span>}
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-gray-400">Installments</span>
          <input name="installment_count" type="number" min={1} max={24} defaultValue={1} className={input} />
          {errors.installment_count && <span className="block text-xs text-red-300">{errors.installment_count}</span>}
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="block text-xs text-gray-400">Notes</span>
          <input name="notes" maxLength={255} className={input} />
        </label>
        <div className="w-40">
          <SubmitButton loading={loading}>Record</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
