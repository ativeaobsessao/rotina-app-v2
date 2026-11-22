import { getLocalDateString } from './date';

export interface ShoppingItemRecord {
  id: string;
  family_id: string;
  patient_id: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  is_urgent: boolean;
  status: 'pending' | 'purchased';
  price_cents: number | null;
  requested_by: string;
  purchased_by: string | null;
  purchased_at: string | null;
  purchased_date: string | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
  requester?: { name: string } | null;
  purchaser?: { name: string } | null;
  updater?: { name: string } | null;
}

export interface MonthlyExpenseSummary {
  monthKey: string; // YYYY-MM
  label: string; // Ex: Nov/26
  totalCents: number;
  itemCount: number;
  pricedCount: number;
}

export interface ShoppingExpensesSummary {
  totalCents: number;
  itemCount: number;
  pricedCount: number;
  unpricedCount: number;
  urgentCount: number;
  currentMonthCents: number;
  currentMonthCount: number;
  semesterCents: number;
  semesterCount: number;
  monthlyBreakdown: MonthlyExpenseSummary[];
}

const SHORT_MONTHS_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

export function formatPriceBRL(priceCents: number | null | undefined): string {
  if (priceCents === null || priceCents === undefined || !Number.isFinite(priceCents)) {
    return 'Sem valor';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(priceCents / 100);
}

export function formatCentsForInput(priceCents: number | null | undefined): string {
  if (priceCents === null || priceCents === undefined || !Number.isFinite(priceCents)) {
    return '';
  }
  return (priceCents / 100).toFixed(2).replace('.', ',');
}

export function parsePriceInputToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept "24,90", "24.90", "R$ 1.250,50", "1250"
  let normalized = trimmed.replace(/r\$\s*/gi, '').replace(/\s+/g, '');
  if (!/^[0-9.,]+$/.test(normalized)) {
    throw new Error('Informe um valor válido em reais (ex: 24,90).');
  }

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    // 1.250,50 -> remove thousand dots, convert comma to dot
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Informe um valor positivo em reais (ex: 24,90).');
  }
  if (parsed > 1_000_000) {
    throw new Error('O valor informado excede o limite permitido.');
  }

  return Math.round(parsed * 100);
}

export function getMonthKeyFromDate(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function formatMonthKeyLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const monthIdx = Number(mStr) - 1;
  const label = SHORT_MONTHS_PT[monthIdx] || mStr;
  return `${label}/${yStr.slice(-2)}`;
}

export function getMonthStartDate(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

export function shiftMonthsFromMonthKey(monthKey: string, deltaMonths: number): string {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const monthZero = Number(mStr) - 1;
  const d = new Date(Date.UTC(year, monthZero + deltaMonths, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getPreviousMonthRange(referenceDateStr = getLocalDateString()): {
  startDate: string;
  endDate: string;
} {
  const prevMonthKey = shiftMonthsFromMonthKey(getMonthKeyFromDate(referenceDateStr), -1);
  const [yStr, mStr] = prevMonthKey.split('-');
  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
  return {
    startDate: `${prevMonthKey}-01`,
    endDate: `${prevMonthKey}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function getSixMonthsCutoffTimestamp(now: Date = new Date()): number {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.getTime();
}

export function isExpiredShoppingPurchase(
  purchasedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!purchasedAt) return false;
  const ts = Date.parse(purchasedAt);
  if (!Number.isFinite(ts)) return false;
  return ts < getSixMonthsCutoffTimestamp(now);
}

export function sortPendingShoppingItems<T extends Pick<ShoppingItemRecord, 'is_urgent' | 'created_at'>>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    if (a.is_urgent !== b.is_urgent) {
      return a.is_urgent ? -1 : 1;
    }
    return String(a.created_at).localeCompare(String(b.created_at));
  });
}

export function filterShoppingHistoryItems(
  items: ShoppingItemRecord[],
  options: {
    query?: string;
    startDate?: string;
    endDate?: string;
    urgentOnly?: boolean;
  }
): ShoppingItemRecord[] {
  const q = (options.query || '').trim().toLowerCase();
  const { startDate, endDate, urgentOnly } = options;

  return items.filter((item) => {
    if (item.status !== 'purchased') return false;
    if (isExpiredShoppingPurchase(item.purchased_at)) return false;

    const pDate = item.purchased_date || '';
    if (startDate && pDate && pDate < startDate) return false;
    if (endDate && pDate && pDate > endDate) return false;
    if (urgentOnly && !item.is_urgent) return false;

    if (q) {
      const haystack = [
        item.name,
        item.quantity || '',
        item.notes || '',
        item.requester?.name || '',
        item.purchaser?.name || '',
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

export function summarizeShoppingExpenses(
  filteredItems: ShoppingItemRecord[],
  allRetainedItems: ShoppingItemRecord[],
  referenceDateStr = getLocalDateString()
): ShoppingExpensesSummary {
  const currentMonthKey = getMonthKeyFromDate(referenceDateStr);
  const oldestSemesterMonthKey = shiftMonthsFromMonthKey(currentMonthKey, -5);

  let totalCents = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let urgentCount = 0;

  for (const item of filteredItems) {
    if (item.is_urgent) urgentCount += 1;
    if (typeof item.price_cents === 'number') {
      totalCents += item.price_cents;
      pricedCount += 1;
    } else {
      unpricedCount += 1;
    }
  }

  let currentMonthCents = 0;
  let currentMonthCount = 0;
  let semesterCents = 0;
  let semesterCount = 0;

  const monthMap = new Map<string, MonthlyExpenseSummary>();

  for (const item of allRetainedItems) {
    if (item.status !== 'purchased' || isExpiredShoppingPurchase(item.purchased_at)) continue;
    const dateStr = item.purchased_date || (item.purchased_at ? item.purchased_at.slice(0, 10) : '');
    if (!dateStr) continue;

    const mKey = getMonthKeyFromDate(dateStr);
    const itemCents = typeof item.price_cents === 'number' ? item.price_cents : 0;
    const hasPrice = typeof item.price_cents === 'number';

    if (mKey === currentMonthKey) {
      currentMonthCents += itemCents;
      currentMonthCount += 1;
    }

    if (mKey >= oldestSemesterMonthKey && mKey <= currentMonthKey) {
      semesterCents += itemCents;
      semesterCount += 1;
    }

    const existing = monthMap.get(mKey) || {
      monthKey: mKey,
      label: formatMonthKeyLabel(mKey),
      totalCents: 0,
      itemCount: 0,
      pricedCount: 0,
    };
    existing.totalCents += itemCents;
    existing.itemCount += 1;
    if (hasPrice) existing.pricedCount += 1;
    monthMap.set(mKey, existing);
  }

  const monthlyBreakdown = Array.from(monthMap.values()).sort((a, b) =>
    b.monthKey.localeCompare(a.monthKey)
  );

  return {
    totalCents,
    itemCount: filteredItems.length,
    pricedCount,
    unpricedCount,
    urgentCount,
    currentMonthCents,
    currentMonthCount,
    semesterCents,
    semesterCount,
    monthlyBreakdown,
  };
}
