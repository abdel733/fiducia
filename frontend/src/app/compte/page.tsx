"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, CircleUserRound, LoaderCircle, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { AppProviders, useSession } from "@/components/providers";
import { apiRequest } from "@/lib/api";

type Account = { user: { id: string; phone: string | null; roles: string[]; createdAt: string; consents: { kind: string; version: string; acceptedAt: string }[] } };

function AccountContent() {
  const router = useRouter();
  const { accessToken, ready, setAccessToken } = useSession();
  const [message, setMessage] = useState("");
  const [shopSubmitted, setShopSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const account = useQuery({ queryKey: ["account"], queryFn: () => apiRequest<Account>("users/me", accessToken!), enabled: Boolean(accessToken) });

  useEffect(() => {
    setShopSubmitted(new URLSearchParams(window.location.search).get("boutique") === "envoyee");
  }, []);

  async function signOut() {
    setPending(true);
    try {
      await apiRequest("auth/logout", accessToken ?? undefined, { method: "POST" });
    } finally {
      setAccessToken(null);
      router.push("/");
    }
  }

  async function exportData() {
    if (!accessToken) return;
    setPending(true);
    try {
      const data = await apiRequest<Account>("users/me/export", accessToken);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "fiducia-export-personnel.json";
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Votre export a été téléchargé.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export indisponible.");
    } finally {
      setPending(false);
    }
  }

  async function deleteAccount() {
    if (!accessToken || !window.confirm("Supprimer votre compte et vos données personnelles ? Cette action est irréversible.")) return;
    setPending(true);
    try {
      await apiRequest("users/me", accessToken, { method: "DELETE" });
      setAccessToken(null);
      router.push("/?compte=supprime");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "La suppression n’a pas abouti.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) return <main className="account-page"><div className="loading-line"><LoaderCircle className="spin" size={18} /> Chargement sécurisé…</div></main>;
  if (!accessToken) return <main className="account-page"><div className="account-empty"><CircleUserRound size={34} /><h1>Votre espace Fiducia</h1><p>Connectez-vous pour consulter votre compte ou créer une boutique.</p><Link className="button button-primary" href="/connexion">Se connecter</Link></div></main>;

  const user = account.data?.user;
  return (
    <main className="account-page">
      <div className="auth-top"><BrandMark /><Link href="/" className="back-link"><ArrowLeft size={16} /> Accueil</Link></div>
      <section className="account-content">
        <div className="account-heading"><div><span className="eyebrow"><CircleUserRound size={15} /> ESPACE PERSONNEL</span><h1>Mon compte</h1></div><button className="icon-text-button" disabled={pending} onClick={signOut}><LogOut size={16} /> Déconnexion</button></div>
        {shopSubmitted && <div className="success-alert"><ShieldCheck size={18} /> Votre dossier boutique est envoyé et en attente de vérification.</div>}
        {account.isLoading ? <div className="loading-line"><LoaderCircle className="spin" size={18} /> Chargement…</div> : account.isError ? <div className="form-alert" role="alert">{account.error.message}</div> : user ? <>
          <section className="account-section"><div className="account-section-heading"><h2>Informations personnelles</h2><span className="status-label"><span /> Compte actif</span></div><dl className="account-details"><div><dt>Téléphone</dt><dd>{user.phone}</dd></div><div><dt>Membre depuis</dt><dd>{new Date(user.createdAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long" })}</dd></div><div><dt>Accès</dt><dd>{user.roles.join(" · ")}</dd></div><div><dt>Consentements</dt><dd>{user.consents.length} enregistrement(s)</dd></div></dl></section>
          <section className="account-section shop-cta"><div><span className="eyebrow"><ShieldCheck size={14} /> VENDEUR</span><h2>Vous vendez des iPhone ?</h2><p>Créez votre boutique et envoyez les pièces de vérification.</p></div><Link className="button button-dark" href="/boutique/nouvelle">Créer une boutique <Plus size={16} /></Link></section>
          <section className="account-section account-actions"><div><h2>Vos données</h2><p>Exportez vos informations ou demandez la suppression de votre compte.</p></div><div className="action-buttons"><button className="icon-text-button" disabled={pending} onClick={exportData}><ArrowDownToLine size={16} /> Exporter</button><button className="danger-button" disabled={pending} onClick={deleteAccount}><Trash2 size={16} /> Supprimer le compte</button></div></section>
        </> : null}
        {message && <div className="form-alert" role="status">{message}</div>}
      </section>
    </main>
  );
}

export default function AccountPage() {
  return <AppProviders><AccountContent /></AppProviders>;
}