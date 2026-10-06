import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader, VerdictBadge } from "@/components/fiducia-components";

type CertificateCheck = { code: string; status: string; signatureValid: boolean; valid: boolean };
type CheckState = { result: CertificateCheck | null; unavailable: boolean };

async function checkCertificate(code: string): Promise<CheckState> {
  try {
    const apiBase = process.env.FIDUCIA_API_URL ?? "http://localhost:4000/v1";
    const response = await fetch(`${apiBase}/verify/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!response.ok) return { result: null, unavailable: true };
    const result = await response.json() as CertificateCheck;
    if (typeof result.valid !== "boolean" || typeof result.signatureValid !== "boolean" || typeof result.status !== "string") {
      return { result: null, unavailable: true };
    }
    return { result, unavailable: false };
  } catch {
    return { result: null, unavailable: true };
  }
}

export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const validFormat = /^FD-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
  const { result, unavailable } = validFormat ? await checkCertificate(code) : { result: null, unavailable: false };
  const valid = result?.valid === true && result.signatureValid && result.status === "ACTIVE";
  const verdict = valid ? "valid" : result?.status === "EXPIRED" ? "warning" : "rejected";

  return <main className="f-home">
    <SiteHeader />
    <section className="f-public-verify">
      <span className="f-section-kicker">Vérification publique</span>
      <h1>Certificat Fiducia</h1>
      <p className="f-public-lead">Contrôle du statut et de la signature numérique.</p>
      <div className="f-public-card">
        <span className="f-card-kicker">Code du certificat</span>
        <code className="f-public-code">{code}</code>
        {!validFormat
          ? <div className="f-public-status"><VerdictBadge verdict="warning">Format de code invalide</VerdictBadge><p>Vérifie le code figurant sur le certificat et réessaie.</p></div>
          : unavailable
            ? <div className="f-public-status"><VerdictBadge verdict="warning">Vérification indisponible</VerdictBadge><p>L’état du certificat n’a pas pu être confirmé. Réessaie plus tard.</p></div>
            : <div className="f-public-status">
              <VerdictBadge verdict={verdict}>{valid ? "Certificat actif · signature valide" : result?.status === "EXPIRED" ? "Certificat expiré" : "Certificat invalide ou révoqué"}</VerdictBadge>
              <p>{valid ? "Le statut et la signature sont valides au moment de cette consultation." : result?.status === "EXPIRED" ? "La période de validité de ce certificat est terminée." : "Le statut ou la signature de ce certificat ne peut pas être confirmé comme valide."}</p>
            </div>}
        <p className="f-public-caveat">Ce contrôle porte sur le certificat et sa signature. Il ne constitue pas une garantie d’origine.</p>
      </div>
      <Link className="f-public-back" href="/"><ArrowLeft aria-hidden="true" size={16} /> Retour à l’accueil</Link>
    </section>
  </main>;
}
