"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, FileCheck2, LoaderCircle, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { AppProviders, useSession } from "@/components/providers";
import { apiRequest } from "@/lib/api";

const shopSchema = z.object({
  name: z.string().min(2, "Le nom est requis.").max(120),
  city: z.string().min(2, "La ville est requise.").max(80),
  address: z.string().min(4, "L’adresse est requise.").max(240),
  whatsapp: z.string().regex(/^\+229[0-9]{8}$/, "Format attendu : +229XXXXXXXX."),
  ifu: z.string().max(30).optional(),
  rccm: z.string().max(30).optional(),
});
type ShopValues = z.infer<typeof shopSchema>;

function NewShopContent() {
  const router = useRouter();
  const { accessToken, ready } = useSession();
  const [logo, setLogo] = useState<File | null>(null);
  const [documents, setDocuments] = useState<{ managerId: File | null; ifu: File | null; rccm: File | null; photo: File | null }>({ managerId: null, ifu: null, rccm: null, photo: null });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const form = useForm<ShopValues>({ resolver: zodResolver(shopSchema), defaultValues: { name: "", city: "Cotonou", address: "", whatsapp: "+229", ifu: "", rccm: "" } });

  async function submit(values: ShopValues) {
    if (!accessToken) {
      setMessage("Connectez-vous pour créer votre boutique.");
      return;
    }
    if (!documents.managerId) {
      setMessage("Ajoutez la pièce d’identité du gérant pour envoyer le dossier.");
      return;
    }
    if ((values.ifu || values.rccm) && (!documents.ifu || !documents.rccm)) {
      setMessage("Pour une boutique professionnelle, ajoutez les justificatifs IFU et RCCM.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const shop = await apiRequest<{ id: string }>("shops", accessToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      if (logo) {
        const logoData = new FormData();
        logoData.set("file", logo);
        await apiRequest(`shops/${shop.id}/logo`, accessToken, { method: "POST", body: logoData });
      }
      const uploads = [
        { kind: "MANAGER_ID", file: documents.managerId },
        { kind: "IFU", file: documents.ifu },
        { kind: "RCCM", file: documents.rccm },
        { kind: "SHOP_PHOTO", file: documents.photo },
      ].filter((item): item is { kind: string; file: File } => item.file !== null);
      for (const item of uploads) {
        const formData = new FormData();
        formData.set("kind", item.kind);
        formData.set("file", item.file);
        await apiRequest(`shops/${shop.id}/documents`, accessToken, { method: "POST", body: formData });
      }
      router.push("/compte?boutique=envoyee");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Le dossier n’a pas pu être envoyé. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="form-page">
      <div className="auth-top"><BrandMark /><Link href="/compte" className="back-link"><ArrowLeft size={16} /> Mon compte</Link></div>
      <section className="form-page-content">
        <div className="form-heading"><span className="eyebrow"><Store size={15} /> ESPACE VENDEUR</span><h1>Créer votre boutique</h1><p>Votre boutique sera examinée avant d’être visible sur Fiducia.</p></div>
        {!ready ? <div className="loading-line"><LoaderCircle className="spin" size={18} /> Vérification de votre session…</div> : !accessToken ? <div className="form-alert">Vous devez <Link href="/connexion">vous connecter</Link> pour continuer.</div> : null}
        <form className="shop-form" onSubmit={form.handleSubmit(submit)}>
          <div className="form-section-title"><span>01</span><div><h2>Informations de la boutique</h2><p>Ces informations seront visibles sur votre vitrine après validation.</p></div></div>
          <div className="form-grid">
            <label className="field"><span>Nom de la boutique</span><input {...form.register("name")} placeholder="Ex. Mobile Cotonou" />{form.formState.errors.name && <small>{form.formState.errors.name.message}</small>}</label>
            <label className="field"><span>Ville</span><input {...form.register("city")} placeholder="Cotonou" />{form.formState.errors.city && <small>{form.formState.errors.city.message}</small>}</label>
            <label className="field field-full"><span>Adresse</span><input {...form.register("address")} placeholder="Quartier, rue ou repère" />{form.formState.errors.address && <small>{form.formState.errors.address.message}</small>}</label>
            <label className="field"><span>WhatsApp professionnel</span><input inputMode="tel" {...form.register("whatsapp")} placeholder="+229 97 00 00 00" />{form.formState.errors.whatsapp && <small>{form.formState.errors.whatsapp.message}</small>}</label>
            <label className="field"><span>IFU <i>si professionnel</i></span><input {...form.register("ifu")} placeholder="Facultatif" /></label>
            <label className="field"><span>RCCM <i>si professionnel</i></span><input {...form.register("rccm")} placeholder="Facultatif" /></label>
          </div>
          <div className="form-section-title document-heading"><span>02</span><div><h2>Logo et pièces de vérification</h2><p>Les pièces d’identité sont chiffrées avant stockage privé. 8 Mo maximum par document.</p></div></div>
          <div className="upload-grid">
            <label className="file-drop"><FileCheck2 size={22} /><span>{logo ? logo.name : "Logo de la boutique"}</span><small>{logo ? `${(logo.size / 1024 / 1024).toFixed(1)} Mo` : "Image PNG ou JPG · 2 Mo max."}</small><input accept="image/jpeg,image/png" onChange={(event) => setLogo(event.target.files?.[0] ?? null)} type="file" /></label>
            <label className="file-drop"><FileCheck2 size={22} /><span>{documents.managerId ? documents.managerId.name : "Pièce du gérant · obligatoire"}</span><small>{documents.managerId ? `${(documents.managerId.size / 1024 / 1024).toFixed(1)} Mo` : "PDF, JPG ou PNG · 8 Mo max."}</small><input accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocuments((current) => ({ ...current, managerId: event.target.files?.[0] ?? null }))} type="file" /></label>
            <label className="file-drop"><FileCheck2 size={22} /><span>{documents.ifu ? documents.ifu.name : "Justificatif IFU · professionnel"}</span><small>{documents.ifu ? `${(documents.ifu.size / 1024 / 1024).toFixed(1)} Mo` : "PDF, JPG ou PNG · facultatif"}</small><input accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocuments((current) => ({ ...current, ifu: event.target.files?.[0] ?? null }))} type="file" /></label>
            <label className="file-drop"><FileCheck2 size={22} /><span>{documents.rccm ? documents.rccm.name : "Justificatif RCCM · professionnel"}</span><small>{documents.rccm ? `${(documents.rccm.size / 1024 / 1024).toFixed(1)} Mo` : "PDF, JPG ou PNG · facultatif"}</small><input accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocuments((current) => ({ ...current, rccm: event.target.files?.[0] ?? null }))} type="file" /></label>
            <label className="file-drop"><FileCheck2 size={22} /><span>{documents.photo ? documents.photo.name : "Photo de la boutique"}</span><small>{documents.photo ? `${(documents.photo.size / 1024 / 1024).toFixed(1)} Mo` : "PDF, JPG ou PNG · facultatif"}</small><input accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocuments((current) => ({ ...current, photo: event.target.files?.[0] ?? null }))} type="file" /></label>
          </div>
          {message && <div className="form-alert" role="alert">{message}</div>}
          <div className="form-actions"><span>Statut initial : <strong>En attente de vérification</strong></span><Button disabled={pending || !accessToken || !ready} type="submit">{pending ? <LoaderCircle className="spin" size={18} /> : <>Envoyer le dossier <ArrowRight size={16} /></>}</Button></div>
        </form>
      </section>
    </main>
  );
}

export default function NewShopPage() {
  return <AppProviders><NewShopContent /></AppProviders>;
}