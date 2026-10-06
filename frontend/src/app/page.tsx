import Link from "next/link";
import { CertificateCard, PaymentBars, PaymentOptionCard, PrimaryLink, RingsBackground, SiteHeader, SourcesCard, TrustChip } from "@/components/fiducia-components";
import { ImeiWidget } from "@/components/fiducia-interactive";
import { DeferredScrollScene } from "@/components/fiducia-scene-loader";

export default function Home() {
  return (
    <main className="f-home">
      <SiteHeader />
      <section className="f-hero">
        <div className="f-hero-copy">
          <span className="f-eyebrow"><span className="f-live-dot" />Vérification multi-sources · Certificat signé</span>
          <h1>Vérifie l’IMEI.<br /><span>Achète en confiance.</span></h1>
          <p>Le certificat de confiance pour iPhone au Bénin. Plusieurs sources interrogées, un résultat signé, valable 7 jours.</p>
          <div className="f-hero-actions">
            <PrimaryLink href="#verifier">Vérifier un iPhone</PrimaryLink>
            <Link className="f-button f-button--secondary" href="#comment-ca-marche">Voir comment ça marche</Link>
          </div>
        </div>
        <div className="f-verification-wrap">
          <RingsBackground />
          <div className="f-verification-stage">
            <SourcesCard />
            <ImeiWidget />
            <CertificateCard />
          </div>
        </div>
      </section>

      <section className="f-how-section" id="comment-ca-marche">
        <div className="f-section-heading"><span className="f-section-kicker">Simple et documenté</span><h2>Trois étapes pour acheter l’esprit tranquille</h2></div>
        <DeferredScrollScene />
      </section>

      <section className="f-payment-section" id="paiement">
        <div className="f-section-heading"><span className="f-section-kicker">À ton rythme</span><h2>Paie comme ça t’arrange</h2></div>
        <div className="f-payment-grid">
          <PaymentOptionCard>
            <span className="f-payment-label f-payment-label--green">Sans intérêt</span>
            <h3>J’attends</h3>
            <p>Vous payez en plusieurs fois, au même prix qu’au comptant. Vous retirez votre iPhone après le dernier versement.</p>
            <PaymentBars />
          </PaymentOptionCard>
          <PaymentOptionCard tone="amber">
            <span className="f-payment-label f-payment-label--dark">Crédit d’un partenaire agréé</span>
            <h3>Je l’ai tout de suite</h3>
            <p>Un établissement agréé avance le solde. Vous retirez votre iPhone dès la première tranche.</p>
            <p className="f-credit-disclosure">TAEG : [TAEG] · Coût total : [Prix]. Un crédit vous engage et doit être remboursé.</p>
          </PaymentOptionCard>
        </div>
      </section>

      <section className="f-trust-section" aria-label="Engagements de confiance">
        <div className="f-trust-grid">
          <TrustChip>Paiement par Mobile Money</TrustChip><TrustChip>Vendeurs vérifiés</TrustChip>
          <TrustChip>Certificat signé et révocable</TrustChip><TrustChip>Données personnelles protégées</TrustChip>
        </div>
      </section>

      <footer className="f-footer" id="aide">
        <Link className="f-footer-brand" href="/">Fiducia</Link>
        <p>Fiducia est un service de Fiducia Tech, qui n’est pas un établissement financier. Le certificat indique l’absence de signalement dans les bases consultées à la date indiquée ; ce n’est pas une garantie d’origine.</p>
        <nav aria-label="Liens juridiques"><Link href="/conditions">Conditions</Link><Link href="/confidentialite">Confidentialité</Link></nav>
      </footer>
    </main>
  );
}
