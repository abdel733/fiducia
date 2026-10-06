"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { AppProviders, useSession } from "@/components/providers";
import { apiRequest } from "@/lib/api";

const phoneSchema = z.object({ phone: z.string().regex(/^\+229[0-9]{8}$/, "Saisissez un numéro béninois au format +229XXXXXXXX.") });
const consentAccepted = z.boolean().refine((value) => value, "Ce consentement est requis.");
const verifySchema = phoneSchema.extend({ code: z.string().regex(/^[0-9]{6}$/, "Le code comporte 6 chiffres."), termsAccepted: consentAccepted, privacyAccepted: consentAccepted, purposesAccepted: consentAccepted });
type PhoneValues = z.infer<typeof phoneSchema>;
type VerifyValues = z.infer<typeof verifySchema>;

function SignInContent() {
  const router = useRouter();
  const { setAccessToken } = useSession();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const phoneForm = useForm<PhoneValues>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: "+229" } });
  const verifyForm = useForm<VerifyValues>({ resolver: zodResolver(verifySchema), defaultValues: { phone: "", code: "", termsAccepted: false, privacyAccepted: false, purposesAccepted: false } });

  async function requestCode(values: PhoneValues) {
    setPending(true);
    setMessage("");
    try {
      await apiRequest("auth/otp/request", undefined, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: values.phone }) });
      setPhone(values.phone);
      verifyForm.setValue("phone", values.phone);
      setStep("code");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible d’envoyer le code. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(values: VerifyValues) {
    setPending(true);
    setMessage("");
    try {
      const session = await apiRequest<{ accessToken: string }>("auth/otp/verify", undefined, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: values.phone, code: values.code, consentVersion: "2026-10", termsAccepted: values.termsAccepted, privacyAccepted: values.privacyAccepted, purposesAccepted: values.purposesAccepted }),
      });
      setAccessToken(session.accessToken);
      router.push("/compte");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Code invalide ou expiré.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-top"><BrandMark /><Link href="/" className="back-link"><ArrowLeft size={16} /> Accueil</Link></div>
      <section className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow"><LockKeyhole size={14} /> ACCÈS SÉCURISÉ</span>
          <h1>Votre numéro,<br /><em>votre espace.</em></h1>
          <p>Un code à usage unique protège l’accès à votre compte. Aucun mot de passe à mémoriser.</p>
          <div className="auth-assurance"><ShieldCheck size={20} /><span>Vos données sont traitées avec soin<br />et vos consentements sont horodatés.</span></div>
        </div>
        <div className="auth-form-panel">
          <div className="step-marker"><span className={step === "phone" ? "active" : "complete"}>{step === "code" ? <Check size={14} /> : "01"}</span><i /><span className={step === "code" ? "active" : ""}>02</span></div>
          {step === "phone" ? (
            <>
              <h2>Connexion ou inscription</h2>
              <p className="form-lead">Nous vous enverrons un code de vérification par SMS.</p>
              <form className="form-stack" onSubmit={phoneForm.handleSubmit(requestCode)}>
                <label htmlFor="phone">Numéro de téléphone</label>
                <input autoComplete="tel" id="phone" inputMode="tel" placeholder="+229 97 00 00 00" {...phoneForm.register("phone")} />
                {phoneForm.formState.errors.phone && <span className="field-error">{phoneForm.formState.errors.phone.message}</span>}
                {message && <div className="form-alert" role="alert">{message}</div>}
                <Button size="wide" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={18} /> : <>Recevoir mon code <ArrowRight size={17} /></>}</Button>
              </form>
            </>
          ) : (
            <>
              <button className="text-back" onClick={() => setStep("phone")} type="button"><ArrowLeft size={15} /> Modifier le numéro</button>
              <h2>Vérifiez votre numéro</h2>
              <p className="form-lead">Saisissez le code envoyé au <strong>{phone}</strong>. Il expire dans 5 minutes.</p>
              <form className="form-stack" onSubmit={verifyForm.handleSubmit(verifyCode)}>
                <label htmlFor="code">Code à 6 chiffres</label>
                <input autoComplete="one-time-code" id="code" inputMode="numeric" maxLength={6} placeholder="000000" {...verifyForm.register("code")} />
                {verifyForm.formState.errors.code && <span className="field-error">{verifyForm.formState.errors.code.message}</span>}
                <label className="consent-row"><input type="checkbox" {...verifyForm.register("termsAccepted")} /><span>J’accepte les <Link href="/conditions">conditions d’utilisation</Link>.</span></label>
                <label className="consent-row"><input type="checkbox" {...verifyForm.register("privacyAccepted")} /><span>J’ai lu la <Link href="/confidentialite">politique de confidentialité</Link>.</span></label>
                <label className="consent-row"><input type="checkbox" {...verifyForm.register("purposesAccepted")} /><span>J’accepte le traitement de mes données pour utiliser Fiducia.</span></label>
                {(verifyForm.formState.errors.termsAccepted || verifyForm.formState.errors.privacyAccepted || verifyForm.formState.errors.purposesAccepted) && <span className="field-error">Les trois consentements sont requis pour créer votre compte.</span>}
                {message && <div className="form-alert" role="alert">{message}</div>}
                <Button size="wide" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={18} /> : <>Continuer <ArrowRight size={17} /></>}</Button>
              </form>
            </>
          )}
          <p className="form-footnote">En continuant, vous pourrez exercer vos droits d’accès, d’export et de suppression depuis votre compte.</p>
        </div>
      </section>
    </main>
  );
}

export default function SignInPage() {
  return <AppProviders><SignInContent /></AppProviders>;
}