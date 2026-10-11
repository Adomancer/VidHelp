/** Payroll: payment periods, salary slips and kasbon (finance), and a host's own pay. */

import { api, apiFileUrl, post, del, query } from "./client";
import type { Brand, HostWithUser } from "./hosts";

export type PeriodStatus = "in_progress" | "waiting_payment" | "requested" | "paid";

export interface PeriodSummary {
  worked_hours: number;
  carried_in_hours: number;
  /** Billable to the brand: worked + carried in, capped at the target */
  achieved_hours: number;
  carried_out_hours: number;
  target_hours: number;
  total_amount: number;
}

export interface PaymentPeriod {
  id: string;
  brand_id: string;
  period_start: string;
  period_end: string;
  status: PeriodStatus;
  locked_at: string | null;
  brand?: { id: string; name: string };
  /** The live request; cancelled ones only appear in the period's request history */
  payment_request?: {
    id: string;
    status: "requested" | "processing" | "paid";
    requested_at: string;
    paid_at: string | null;
    requester?: { id: string; name: string } | null;
  } | null;
}

export interface PaymentRequestRow {
  id: string;
  status: "requested" | "processing" | "paid" | "cancelled";
  requested_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  requester: { id: string; name: string } | null;
  canceller: { id: string; name: string } | null;
}

export interface PeriodListItem extends PaymentPeriod, PeriodSummary {
  hosts: number;
}

export interface HostPayRow {
  host_id: string;
  name: string;
  session_count: number;
  hours: number;
  rate_per_hour: number;
  amount: number;
  /** true while the period is open: at today's rate, not final */
  estimate: boolean;
}

export interface HourAdjustment {
  id: string;
  host_id: string;
  sessions_added: number;
  hours_added: number;
  notes: string;
  created_at: string;
  host: HostWithUser;
  creator: { id: string; name: string } | null;
}

export interface SalarySlipRow {
  id: string;
  host_id: string;
  gross_amount: number;
  advance_deduction: number;
  net_amount: number;
  generated_at: string;
  skipped_deductions: SlipDeduction[] | null;
  host?: HostWithUser;
}

export interface SlipDeduction {
  type: "early_payment" | "loan";
  seq: number;
  installment_count: number;
  amount: number;
}

export interface SlipDetail {
  id: string;
  host_name: string;
  brand: { id: string; name: string };
  period_start: string;
  period_end: string;
  session_count: number;
  hours: number;
  rate_per_hour: number;
  gross_amount: number;
  advance_deduction: number;
  net_amount: number;
  deductions: SlipDeduction[];
  /** Installments that were due but bigger than the pay left; they wait for the next slip */
  skipped_deductions: SlipDeduction[];
  bank: { bank_name: string | null; account: string | null; holder: string | null } | null;
  generated_at: string;
}

export interface CashAdvance {
  id: string;
  host_id: string;
  type: "early_payment" | "loan";
  total_amount: number;
  installment_count: number;
  notes: string | null;
  status: "unpaid" | "in_progress" | "paid";
  requested_at: string;
  settled_at: string | null;
  settled_note: string | null;
  deducted_amount: number;
  /** Still to be deducted (scheduled installments) */
  remaining_amount: number;
  host: HostWithUser;
  brand: { id: string; name: string } | null;
  settler: { id: string; name: string } | null;
  installments: {
    id: string;
    seq: number;
    amount: number;
    /** settled = paid back outside payroll */
    status: "scheduled" | "deducted" | "skipped" | "settled";
    /** Slips this installment didn't fit in */
    skip_count: number;
    deducted_at: string | null;
  }[];
}

export const payrollApi = {
  /** Brands with their payroll start date (finance can't use the operator brand list). */
  brands: (token: string) => api<{ brands: Pick<Brand, "id" | "name" | "status" | "payroll_start_date">[] }>("/finance/brands", { token }),
  /** Active hosts to pick for kasbon or an adjustment; with brandId, only that brand's. */
  hosts: (token: string, brandId = "") => api<{ hosts: { host_id: string; name: string }[] }>(`/finance/hosts${query({ brand_id: brandId })}`, { token }),
  periods: (token: string, brandId = "") => api<{ periods: PeriodListItem[] }>(`/finance/payroll/periods${query({ brand_id: brandId })}`, { token }),
  period: (token: string, id: string) =>
    api<{
      period: PaymentPeriod;
      summary: PeriodSummary;
      /** Live reports in the period still waiting for review; payment can't be requested until 0 */
      pending_reports: number;
      requests: PaymentRequestRow[];
      hosts: HostPayRow[];
      adjustments: HourAdjustment[];
      slips: SalarySlipRow[];
    }>(`/finance/payroll/periods/${id}`, { token }),
  addAdjustment: (token: string, periodId: string, data: { host_id: string; sessions_added: number; hours_added: number; notes: string }) =>
    post(`/finance/payroll/periods/${periodId}/adjustments`, token, data),
  removeAdjustment: (token: string, id: string) => del(`/finance/payroll/adjustments/${id}`, token),
  requestPayment: (token: string, periodId: string) => post(`/finance/payroll/periods/${periodId}/request`, token),
  cancelRequest: (token: string, periodId: string, reason: string) => post(`/finance/payroll/periods/${periodId}/cancel-request`, token, { reason }),
  markPaid: (token: string, periodId: string) => post(`/finance/payroll/periods/${periodId}/paid`, token),
  exportUrl: (token: string, periodId: string) => apiFileUrl(`/finance/payroll/periods/${periodId}/export`, token),
  slip: (token: string, id: string) => api<{ slip: SlipDetail }>(`/finance/payroll/slips/${id}`, { token }),
  advances: (token: string, status: "open" | "paid" | "" = "") => api<{ advances: CashAdvance[] }>(`/finance/cash-advances${query({ status })}`, { token }),
  createAdvance: (token: string, data: { host_id: string; type: CashAdvance["type"]; total_amount: number; installment_count: number; notes: string | null }) =>
    post("/finance/cash-advances", token, data),
  settleAdvance: (token: string, id: string, note: string | null) => post(`/finance/cash-advances/${id}/settle`, token, { note }),
  rescheduleAdvance: (token: string, id: string, installmentCount: number) =>
    post(`/finance/cash-advances/${id}/reschedule`, token, { installment_count: installmentCount }),
  removeAdvance: (token: string, id: string) => del(`/finance/cash-advances/${id}`, token),
};

export interface MyPay {
  current: {
    period_id: string;
    brand: { id: string; name: string };
    period_start: string;
    period_end: string;
    status: PeriodStatus;
    session_count: number;
    hours: number;
    rate_per_hour: number;
    estimate: number;
  }[];
  slips: {
    id: string;
    brand: { id: string; name: string };
    period_start: string;
    period_end: string;
    gross_amount: number;
    advance_deduction: number;
    net_amount: number;
    generated_at: string;
  }[];
  advances: {
    id: string;
    type: CashAdvance["type"];
    total_amount: number;
    installment_count: number;
    status: CashAdvance["status"];
    notes: string | null;
    requested_at: string;
    remaining: number;
  }[];
}

export const payApi = {
  mine: (token: string) => api<MyPay>("/host/pay", { token }),
  slip: (token: string, id: string) => api<{ slip: SlipDetail }>(`/host/pay/slips/${id}`, { token }),
};
