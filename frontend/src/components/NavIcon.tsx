import {
  ArrowLeftRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Flag,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  Radio,
  Settings,
  ShieldCheck,
  Star,
  Tag,
  Ticket,
  UserRound,
  Users,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Menu icons, referenced by name so server layouts can pass them as strings. */
const icons = {
  dashboard: LayoutDashboard,
  users: Users,
  host: Video,
  live: Radio,
  brand: Tag,
  rates: Layers,
  calendar: CalendarDays,
  event: Ticket,
  backup: ArrowLeftRight,
  report: FileText,
  points: Flag,
  rating: Star,
  payroll: Wallet,
  audit: ClipboardCheck,
  settings: Settings,
  security: ShieldCheck,
  profile: UserRound,
  more: LayoutGrid,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof icons;

export function navIcon(name: NavIconName): LucideIcon {
  return icons[name];
}

export default function NavIcon({ name, className = "size-5" }: { name: NavIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon className={`${className} shrink-0`} aria-hidden="true" />;
}
