import Link from "next/link";
import { ArrowRight, BadgeCheck } from "lucide-react";

export default function CertificationPage() {
  return (
    <main className="page-shell">
      <section className="card card-lg">
        <span className="eyebrow">CERTIFICATION</span>
        <h1>Émettre un certificat d’appareil</h1>
        <p>Le certificat est signé de manière chiffrée, daté et vérifiable par un code public.</p>
        <div className="certificate-box">
          <BadgeCheck size={28} />
          <div>
            <strong>FD-B2C9-7K12</strong>
            <span>Valide • Signature Ed25519 • 7 jours</span>
          </div>
        </div>
        <div className="inline-form">
          <input aria-label="Modèle" defaultValue="iPhone 13 128 Go Bleu" />
          <button type="button" className="button button-lime">Générer le certificat <ArrowRight size={16} /></button>
        </div>
        <Link href="/verifier">Voir la vérification publique</Link>
      </section>
    </main>
  );
}
