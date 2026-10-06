import { ShieldCheck } from "lucide-react";
import Link from "next/link";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Fiducia, accueil" className="brand-mark" href="/">
      <span className="brand-symbol"><ShieldCheck aria-hidden="true" size={21} strokeWidth={2.1} /></span>
      {!compact && <span>fiducia</span>}
    </Link>
  );
}