import Link from "next/link";
import { ArrowLeft, MapPin, ShieldCheck, Star } from "lucide-react";
import { MarketHeader, ProductCard, marketProducts, shopProfiles } from "@/components/marketplace";

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = shopProfiles.find((item) => item.slug === slug) ?? shopProfiles[0];
  const shopProducts = marketProducts.filter((product) => product.shopSlug === slug || product.shopSlug === "mobile-cotonou");

  return (
    <main style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <MarketHeader />
      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "30px auto 0" }}>
        <Link href="/catalogue" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--mut)", fontWeight: 700 }}><ArrowLeft size={16} /> Retour au catalogue</Link>

        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 28, padding: 26, marginTop: 16, boxShadow: "var(--sh)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>Boutique publique</div>
              <h1 style={{ margin: "8px 0 0", fontSize: "clamp(2.1rem,4vw,3.4rem)", lineHeight: 1.1 }}>{shop.name}</h1>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "rgba(180,195,115,0.12)", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
              <ShieldCheck size={16} style={{ color: "var(--acc)" }} /> {shop.certificate}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 18, color: "var(--mut)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={14} /> {shop.city}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Star size={14} fill="currentColor" style={{ color: "var(--acc2)" }} /> {shop.rating}/5</span>
          </div>

          <p style={{ maxWidth: 760, color: "var(--mut)", lineHeight: 1.7, marginTop: 18 }}>{shop.description}</p>
        </div>
      </section>

      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "26px auto 0" }}>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 28 }}>Annonces actives</h2>
          <span style={{ color: "var(--mut)", fontSize: 12, fontWeight: 800 }}>4 annonces visibles</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          {shopProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </main>
  );
}
