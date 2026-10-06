import { ArrowUpRight, ScanLine } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function SiteHeader() {
  return (
    <header className="site-header">
      <BrandMark />
      <nav aria-label="Navigation principale" className="site-nav">
        <Link href="/#comment-ca-marche">Comment ça marche</Link>
        <Link className="nav-verify" href="/verifier"><ScanLine aria-hidden="true" size={15} /> Vérifier</Link>
        <Link className="nav-account" href="/compte">Mon compte <ArrowUpRight aria-hidden="true" size={15} /></Link>
        <Link className="button button-dark nav-login" href="/connexion">Se connecter</Link>
      </nav>
    </header>
  );
}