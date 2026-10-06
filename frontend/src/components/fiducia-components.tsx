import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { ArrowRight, CircleHelp, CircleX, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { MobileHeader, ThemeToggle } from "./fiducia-navigation";

export function GlassCard({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`f-glass-card ${className}`} {...props} />;
}

export function Button({ variant = "primary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return <button className={`f-button f-button--${variant} ${className}`} {...props}>{children}</button>;
}

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`f-badge ${className}`}>{children}</span>;
}

export function VerdictBadge({ verdict, children }: { verdict: "valid" | "warning" | "rejected"; children: ReactNode }) {
  const Icon = verdict === "valid" ? ShieldCheck : verdict === "warning" ? CircleHelp : CircleX;
  return <span className={`f-verdict f-verdict--${verdict}`}><Icon aria-hidden="true" size={15} />{children}</span>;
}

export function SourcesCard({ className = "" }: { className?: string }) {
  return (
    <GlassCard className={`f-sources-card ${className}`}>
      <span className="f-card-kicker">Sources consultées</span>
      <strong className="f-source-count">[N]</strong>
      <div className="f-chip-list" aria-label="Sources de vérification">
        <Badge>Listes de vol</Badge><Badge>Activation Lock</Badge><Badge>Modèle (TAC)</Badge>
      </div>
    </GlassCard>
  );
}

export function CertificateCard({ className = "" }: { className?: string }) {
  return (
    <GlassCard className={`f-certificate-card ${className}`}>
      <div className="f-certificate-top"><code>FD-XXXX-XXXX</code><div className="f-qr-wrap"><div className="f-qr-placeholder" aria-hidden="true"><i /><i /><i /><i /></div><span>QR après émission</span></div></div>
      <span className="f-card-kicker">Aperçu du certificat</span>
      <h3>[Modèle] · [Capacité]</h3>
      <Badge className="f-badge--outline">Non émis</Badge>
      <p>Aucun signalement trouvé dans les bases consultées ([sources]) le [date].</p>
      <p>Valable jusqu’au [date].</p>
      <div className="f-chip-list f-certificate-sources" aria-label="Sources susceptibles d’être consultées">
        <Badge>Listes de vol</Badge><Badge>Activation Lock</Badge><Badge>Modèle (TAC)</Badge>
      </div>
    </GlassCard>
  );
}

export function PaymentOptionCard({ tone = "glass", children, className = "" }: { tone?: "glass" | "amber"; children: ReactNode; className?: string }) {
  return <article className={`f-payment-card f-payment-card--${tone} ${className}`}>{children}</article>;
}

export function TrustChip({ children }: { children: ReactNode }) {
  return <div className="f-trust-chip"><ShieldCheck aria-hidden="true" size={17} />{children}</div>;
}

function BrandLink() {
  return <Link className="f-brand" href="/" aria-label="Fiducia, accueil"><span className="f-brand-symbol"><ShieldCheck aria-hidden="true" size={21} /></span><span>Fiducia</span></Link>;
}

export function SiteHeader() {
  return (
    <header className="f-site-header">
      <BrandLink />
      <nav className="f-desktop-nav" aria-label="Navigation principale">
        <Link className="is-active" aria-current="page" href="/">Accueil</Link><Link href="#verifier">Vérifier</Link>
        <Link href="/certification">Catalogue</Link><Link href="#paiement">Paiement</Link>
        <Link href="/boutique/nouvelle">Partenaires</Link><Link href="#aide">Aide</Link>
      </nav>
      <div className="f-header-actions"><ThemeToggle /><Link className="f-login-link" href="/connexion">Connexion</Link><Link className="f-button f-button--primary f-account-link" href="/connexion">Créer un compte</Link></div>
      <MobileHeader />
    </header>
  );
}

export function RingsBackground() {
  return <div className="f-rings-background" aria-hidden="true"><span className="f-ring f-ring--wide" /><span className="f-ring f-ring--fine" /></div>;
}

export function PaymentBars() {
  return <div className="f-payment-bars" role="img" aria-label="Répartition des versements : 40 %, 30 %, 30 %">
    <div><span className="f-payment-bar f-payment-bar--first" /><small>Versement 1</small></div>
    <div><span className="f-payment-bar f-payment-bar--second" /><small>Versement 2</small></div>
    <div><span className="f-payment-bar f-payment-bar--third" /><small>Versement 3</small></div>
  </div>;
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="f-button f-button--primary" href={href}>{children}<ArrowRight aria-hidden="true" size={17} /></Link>;
}