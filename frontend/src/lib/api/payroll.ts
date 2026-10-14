/** Payroll: payment periods, salary slips and kasbon (finance), and a host's own pay. */

import { api, apiFileUrl, post, del, query } from "./client";
import type { Brand, HostWithUser } from "./hosts";

export type PeriodStatus = "in_progress" | "waiting_payment" | "requested" | "paid";

export interface PeriodSummary {
  /** Every approved hour this period, backups paid by another host included */
  worked_hours: number;
  /** Backups the requesting host paid the cover for directly: billed to the brand, not on payroll */
  host_paid_hours: number;
  carried_in_hours: number;
  /** Billable to the brand: worked + carried in, capped at the target. Hosts are paid for the same hours. */
  achieved_hours: number;
  carried_out_hours: number;
  target_hours: number;
  total_amount: number;
}

export interface PaymentPeriod {
  id: string;
  brand_id: string;
  period_start: string;
  /** Null while it runs: it ends when the target is reached or admin/finance closes it early */
  period_end: string | null;
  status: PeriodStatus;
  closed_at: string | null;
  /** Set when closed early by hand; null when the target closed it */
  closer?: { id: string; name: string } | null;
  locked_at: string | null;
  brand?: { id: string; name: string };
  /** The live request; cancelled ones only appear in the period's request history */
  payment_request?: {
    id: string;
    status: "requested" | "processing" | "paid";
    requested_at: string;
    paid_at: string | null;
    /** The brand's transfer reference, noted when marking it paid */
    payment_reference: string | null;
    requester?: { id: string; name: string } | null;
  } | null;
}

export interface PaymentRequestRow {
  id: string;
  status: "requested" | "processing" | "paid" | "cancelled";
  requested_at: string;
  paid_at: string | null;
  payment_reference: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  requester: { id: string; name: string } | null;
  canceller: { id: string; name: string } | null;
}

export interface PeriodListItem extends PaymentPeriod, PeriodSummary {
  hosts: number;
}

/** Backup hours a host covered that the requesting host paid them for directly (not on payroll) */
export interface HostPaidCover {
  payer: string;
  hours: number;
}

export interface HostPayRow {
  host_id: string;
  name: string;
  session_count: number;
  /** Hours over the last period's target, paid here first */
  carried_in_hours: number;
  /** Approved hours this period (backups paid by another host not included) */
  worked_hours: number;
  /** Paid in this period: carried in + worked − carried out */
  hours: number;
  /** Over the brand's target: unpaid now, paid in the next period */
  carried_out_hours: number;
  rate_per_hour: number;
  amount: number;
  /** true while the period is open: at today's rate, not final */
  estimate: boolean;
  host_paid: HostPaidCover[];
}

/** Open kasbon may not exceed the host's monthly salary by schedule (weekly slot hours × 52/12 × rate). */
export interface AdvanceLimit {
  monthly_salary: number;
  /** Installments not paid back yet */
  outstanding: number;
  available: number;
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
  carried_in_hours: number;
  worked_hours: number;
  /** Paid on this slip */
  hours: number;
  carried_out_hours: number;
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
      /** Sick-leave backups whose letter can still come (who pays the cover isn't known yet); blocks the request too */
      pending_letters: number;
      requests: PaymentRequestRow[];
      hosts: HostPayRow[];
      adjustments: HourAdjustment[];
      slips: SalarySlipRow[];
    }>(`/finance/payroll/periods/${id}`, { token }),
  addAdjustment: (token: string, periodId: string, data: { host_id: string; sessions_added: number; hours_added: number; notes: string }) =>
    post(`/finance/payroll/periods/${periodId}/adjustments`, token, data),
  removeAdjustment: (token: string, id: string) => del(`/finance/payroll/adjustments/${id}`, token),
  /** Close a running period before its target (e.g. the brand stopped going live). */
  closePeriod: (token: string, periodId: string) => post(`/finance/payroll/periods/${periodId}/close`, token),
  /** On the PIC's behalf; normally the brand's leader host requests. */
  requestPayment: (token: string, periodId: string) => post(`/finance/payroll/periods/${periodId}/request`, token),
  cancelRequest: (token: string, periodId: string, reason: string) => post(`/finance/payroll/periods/${periodId}/cancel-request`, token, { reason }),
  markPaid: (token: string, periodId: string, reference: string | null) => post(`/finance/payroll/periods/${periodId}/paid`, token, { reference }),
  exportUrl: (token: string, periodId: string) => apiFileUrl(`/finance/payroll/periods/${periodId}/export`, token),
  slip: (token: string, id: string) => api<{ slip: SlipDetail }>(`/finance/payroll/slips/${id}`, { token }),
  advances: (token: string, status: "open" | "paid" | "" = "") => api<{ advances: CashAdvance[] }>(`/finance/cash-advances${query({ status })}`, { token }),
  advanceLimit: (token: string, hostId: string) => api<{ limit: AdvanceLimit }>(`/finance/cash-advances/limit/${hostId}`, { token }),
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
    period_end: string | null;
    status: PeriodStatus;
    session_count: number;
    carried_in_hours: number;
    worked_hours: number;
    /** Paid in this period so far (over the brand's target carries to the next one) */
    hours: number;
    carried_out_hours: number;
    rate_per_hour: number;
    estimate: number;
    host_paid: HostPaidCover[];
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
  /** Periods of the brands I lead (as PIC), newest first; empty if I lead none. */
  brand_periods: BrandPeriod[];
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

/** A period of a brand I lead: progress to its target and where payment stands. */
export interface BrandPeriod {
  id: string;
  brand: { id: string; name: string };
  period_start: string;
  period_end: string | null;
  status: PeriodStatus;
  target_hours: number;
  /** Carried in + worked; may pass the target (the rest carries to the next period) */
  progress_hours: number;
  /** Billable to the brand: capped at the target */
  achieved_hours: number;
  closed_early: boolean;
  /** Block the request until 0 */
  pending_reports: number;
  pending_letters: number;
  request: { requested_at: string; paid_at: string | null; requester: string | null } | null;
}

export const payApi = {
  mine: (token: string) => api<MyPay>("/host/pay", { token }),
  slip: (token: string, id: string) => api<{ slip: SlipDetail }>(`/host/pay/slips/${id}`, { token }),
  /** As the brand's leader: request payment once the target is reached. */
  requestPayment: (token: string, periodId: string) => post(`/host/pay/periods/${periodId}/request`, token),
  exportUrl: (token: string, periodId: string) => apiFileUrl(`/host/pay/periods/${periodId}/export`, token),
};
