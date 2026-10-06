"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button, GlassCard, VerdictBadge } from "./fiducia-components";

type Verdict = "TRUSTED" | "WARNING" | "REJECTED" | "UNDER_LIEN";
type PublicResult = {
  maskedImei: string;
  verdict: Verdict;
  sourcesConsulted: string[];
  checkedAt: string;
};

export function ImeiWidget() {
  const router = useRouter();
  const [tab, setTab] = useState<"imei" | "certificate">("imei");
  const [imei, setImei] = useState("");
  const [certificateCode, setCertificateCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublicResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (tab === "certificate") {
      const code = certificateCode.trim().toUpperCase();
      if (!code) {
        setError("Saisis le code indiqué sur le certificat.");
        return;
      }
      router.push(`/verify/${encodeURIComponent(code)}`);
      return;
    }
    if (!/^\d{15}$/.test(imei)) {
      setError("L’IMEI doit contenir exactement 15 chiffres.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/backend/imei/verify/public", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imei }),
      });
      const payload = await response.json() as PublicResult & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "La vérification est indisponible pour le moment.");
      if (!["TRUSTED", "WARNING", "REJECTED", "UNDER_LIEN"].includes(payload.verdict) || !Array.isArray(payload.sourcesConsulted) || typeof payload.maskedImei !== "string") {
        throw new Error("La réponse reçue ne permet pas d’afficher un résultat fiable.");
      }
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La vérification est indisponible pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  const verdict = result?.verdict === "TRUSTED" ? "valid" : result?.verdict === "WARNING" ? "warning" : "rejected";
  const outcome = result?.verdict === "TRUSTED"
    ? "Aucun signalement trouvé dans les bases consultées"
    : result?.verdict === "WARNING"
      ? "Couverture partielle : le résultat demande une vérification complémentaire"
      : result?.verdict === "UNDER_LIEN"
        ? "Un gage ou un financement actif a été détecté"
        : "Un signalement ou un blocage a été détecté";
  const checkedDate = result ? new Date(result.checkedAt) : null;
  const formattedDate = checkedDate && !Number.isNaN(checkedDate.getTime())
    ? new Intl.DateTimeFormat("fr-BJ", { dateStyle: "medium", timeStyle: "short" }).format(checkedDate)
    : "la date indiquée";
  const sources = result?.sourcesConsulted.length ? result.sourcesConsulted.join(", ") : "sources non renseignées";

  return <GlassCard className="f-imei-widget" id="verifier">
    <div className="f-tabs" role="tablist" aria-label="Type de vérification">
      <button type="button" role="tab" id="f-imei-tab" aria-selected={tab === "imei"} aria-controls="f-verification-form" onClick={() => { setTab("imei"); setError(""); setResult(null); }}>IMEI</button>
      <button type="button" role="tab" id="f-certificate-tab" aria-selected={tab === "certificate"} aria-controls="f-verification-form" onClick={() => { setTab("certificate"); setError(""); setResult(null); }}>Code certificat</button>
    </div>
    <form id="f-verification-form" role="tabpanel" aria-labelledby={tab === "imei" ? "f-imei-tab" : "f-certificate-tab"} onSubmit={submit} noValidate>
      <label htmlFor="f-verification-value">{tab === "imei" ? "Numéro IMEI" : "Code certificat"}</label>
      {tab === "imei"
        ? <input id="f-verification-value" className="f-mono-input" inputMode="numeric" autoComplete="off" maxLength={15} value={imei} onChange={(event) => setImei(event.target.value.replace(/\D/g, "").slice(0, 15))} placeholder="Saisis les 15 chiffres" />
        : <input id="f-verification-value" className="f-mono-input" autoComplete="off" value={certificateCode} onChange={(event) => setCertificateCode(event.target.value)} placeholder="FD-XXXX-XXXX" />}
      <div className="f-widget-bottom">
        <p>{tab === "imei" ? <>Tape <code>*#06#</code> sur le téléphone pour afficher l’IMEI.</> : "Le code figure sur le certificat Fiducia."}</p>
        <Button type="submit" disabled={loading}>{loading ? <><LoaderCircle className="f-spin" aria-hidden="true" size={17} /> Vérification…</> : <>Vérifier <ArrowRight aria-hidden="true" size={16} /></>}</Button>
      </div>
    </form>
    {error && <p className="f-form-error" role="alert">{error}</p>}
    {result && <div className="f-result" role="status" aria-live="polite">
      <VerdictBadge verdict={verdict}>{result.verdict === "TRUSTED" ? "Résultat favorable" : result.verdict === "WARNING" ? "À vérifier" : "Signalement détecté"}</VerdictBadge>
      <p>{outcome}{result.verdict === "TRUSTED" ? ` (${sources}) le ${formattedDate}.` : "."}</p>
      <small>IMEI masqué : <code>{result.maskedImei}</code> · Sources : {sources}</small>
    </div>}
  </GlassCard>;
}
