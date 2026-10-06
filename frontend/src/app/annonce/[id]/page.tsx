import Link from "next/link";
import { ArrowLeft, BadgeCheck, CheckCircle2, MapPin, ShieldCheck, Star } from "lucide-react";
import { MarketHeader, PaymentPlan, WhatsAppButton, marketProducts } from "@/components/marketplace";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = marketProducts.find((item) => item.slug === id) ?? marketProducts[0];

  const gallery = [product.image, "https://images.unsplash.com/photo-1611403119869-1c4ac4c95cc0?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1533228100842-8117d4f7d18e?auto=format&fit=crop&w=1200&q=80"];

  return (
    <main style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <MarketHeader />
      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "28px auto 0" }}>
        <Link href="/catalogue" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--mut)", fontWeight: 700 }}><ArrowLeft size={16} /> Retour au catalogue</Link>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, marginTop: 18 }}>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.85fr", gap: 14 }}>
              <div style={{ height: 440, borderRadius: 28, overflow: "hidden", backgroundImage: `url(${product.image})`, backgroundSize: "cover", backgroundPosition: "center", boxShadow: "var(--sh)" }} />
              <div style={{ display: "grid", gap: 14 }}>
                {gallery.slice(1).map((image, index) => (
                  <div key={index} style={{ height: 210, borderRadius: 22, overflow: "hidden", backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center", boxShadow: "var(--sh)" }} />
                ))}
              </div>
            </div>
          </div>

          <aside style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 28, padding: 24, boxShadow: "var(--sh)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "rgba(180,195,115,0.12)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}><BadgeCheck size={12} /> {product.status}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--mut)", fontSize: 12 }}><MapPin size={12} /> {product.city}</span>
            </div>

            <h1 style={{ margin: "16px 0 8px", fontSize: "clamp(2rem,4vw,3.4rem)", lineHeight: 1.08 }}>{product.title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
              <Star size={15} fill="currentColor" style={{ color: "var(--acc2)" }} />
              <span style={{ fontSize: 12, fontWeight: 800 }}>{product.rating}</span>
              <span style={{ color: "var(--mut)", fontSize: 11 }}>({product.reviews} avis)</span>
            </div>

            <div style={{ fontSize: 42, fontWeight: 900, marginBottom: 18 }}>{new Intl.NumberFormat("fr-BJ", { style: "currency", currency: "XOF", maximumFractionDigits: 0 }).format(product.price)}</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              <span style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{product.capacity}</span>
              <span style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{product.color}</span>
              <span style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{product.battery}</span>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase", marginBottom: 10 }}>Options de paiement</div>
              <PaymentPlan price={product.price} />
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <WhatsAppButton phone="22997000000" message={`Bonjour, je suis intéressé par ${product.title}.`} />
              <Link href={`/boutique/${product.shopSlug}`} className="f-button f-button--secondary">Voir la boutique</Link>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={17} style={{ color: "var(--acc)" }} />
                <strong>Certificat Fiducia actif</strong>
              </div>
              <p style={{ margin: "10px 0 0", color: "var(--mut)", lineHeight: 1.6 }}>
                Contrôle d’IMEI, état de batterie et historique de signalement validés. Certificat signé et vérifiable par le public.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "26px auto 0", display: "grid", gridTemplateColumns: "1fr 0.9fr", gap: 20 }}>
        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 24, padding: 24 }}>
          <h2 style={{ margin: 0, fontSize: 26 }}>Description</h2>
          <p style={{ color: "var(--mut)", lineHeight: 1.7, marginTop: 12 }}>
            {product.title} avec {product.capacity} et finition {product.color}. Appareil vérifié, batterie testée à {product.battery}, état {product.condition.toLowerCase()} et soumis au contrôle de Fiducia avant publication.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
            {['Aucun signalement actif', 'IMEI vérifié par l’équipe', 'Contrôle photo et batterie réalisé', 'Paiement échelonné disponible'].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <CheckCircle2 size={16} style={{ color: "var(--acc)" }} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 24, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>Vendeur</div>
              <h3 style={{ margin: "8px 0 0", fontSize: 24 }}>{product.seller}</h3>
            </div>
            <Link href={`/boutique/${product.shopSlug}`} className="f-button f-button--secondary">Voir la vitrine</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            <ShieldCheck size={16} style={{ color: "var(--acc)" }} />
            <span style={{ fontSize: 12, fontWeight: 800 }}>Boutique vérifiée</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Star size={15} fill="currentColor" style={{ color: "var(--acc2)" }} />
            <span style={{ fontSize: 12, fontWeight: 800 }}>{product.rating}/5</span>
          </div>
        </div>
      </section>
    </main>
  );
}
