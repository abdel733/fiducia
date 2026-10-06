import Link from "next/link";
import { SiteHeader } from "@/components/fiducia-components";
import { ImeiWidget } from "@/components/fiducia-interactive";

export default function VerifierPage() {
  return (
    <main className="f-home">
      <SiteHeader />
      <section className="f-public-verify">
        <span className="f-section-kicker">Vérification multi-sources</span>
        <h1>Vérifie un iPhone avant l’achat</h1>
        <p className="f-public-lead">Saisis un IMEI ou le code d’un certificat pour consulter un résultat réel.</p>
        <ImeiWidget />
        <Link className="f-public-back" href="/">Retour à l’accueil</Link>
      </section>
    </main>
  );
}
