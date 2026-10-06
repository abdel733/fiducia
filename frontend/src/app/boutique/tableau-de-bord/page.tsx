import Link from "next/link";
import { ArrowRight, CheckCircle2, Layers3, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { MarketHeader } from "@/components/marketplace";

const steps = [
  { id: 1, title: "IMEI", description: "Vérification de l’identifiant unique et contrôle du certificat initial." },
  { id: 2, title: "Photos / état", description: "Téléversement des photos, batterie, état et preuve de conformité." },
  { id: 3, title: "Prix / publication", description: "Définition du prix, options de paiement et mise en ligne publique." },
];

export default function SellerDashboardPage() {
  return (
    <main style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <MarketHeader />
      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "30px auto 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>Espace vendeur</div>
            <h1 style={{ margin: "8px 0 0", fontSize: "clamp(2.2rem,4vw,3.5rem)", lineHeight: 1.08 }}>Tableau de bord</h1>
          </div>
          <Link href="/catalogue" className="f-button f-button--primary">Créer une annonce <ArrowRight size={17} /></Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginTop: 22 }}>
          {[
            { label: "Annonces actives", value: "12" },
            { label: "Ventes ce mois", value: "4" },
            { label: "Taux de conversion", value: "31%" },
            { label: "Dossiers certifiés", value: "9" },
          ].map((item) => (
            <div key={item.label} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 20, padding: 20 }}>
              <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 34, fontWeight: 900 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "26px auto 0", display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 20 }}>
        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 28, padding: 24 }}>
          <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>Créer une annonce</div>
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            {steps.map((step) => (
              <div key={step.id} style={{ display: "grid", gridTemplateColumns: "48px 1fr", gap: 14, padding: "14px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", borderRadius: 18 }}>
                <div style={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 12, background: "rgba(180,195,115,0.14)", fontWeight: 900 }}>{step.id}</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{step.title}</div>
                  <div style={{ marginTop: 6, color: "var(--mut)", lineHeight: 1.5 }}>{step.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 28, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>Aperçu</div>
              <h3 style={{ margin: "8px 0 0", fontSize: 24 }}>iPhone 13 Pro Max 256 Go</h3>
            </div>
            <ShieldCheck size={22} style={{ color: "var(--acc)" }} />
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Smartphone size={16} style={{ color: "var(--acc)" }} /> Modèle vérifié</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><CheckCircle2 size={16} style={{ color: "var(--acc)" }} /> Certificat actif</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Layers3 size={16} style={{ color: "var(--acc)" }} /> Photos ajoutées</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Sparkles size={16} style={{ color: "var(--acc)" }} /> Prix prêt à publier</div>
          </div>

          <div style={{ marginTop: 22, padding: "18px 16px", background: "rgba(180,195,115,0.12)", borderRadius: 16 }}>
            <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Prix public</div>
            <div style={{ fontSize: 32, fontWeight: 900, marginTop: 8 }}>362 000 XOF</div>
          </div>
        </aside>
      </section>
    </main>
  );
}
