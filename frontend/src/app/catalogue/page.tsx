import Link from "next/link";
import { ArrowRight, Filter, Search, SlidersHorizontal } from "lucide-react";
import { MarketHeader, ProductCard, marketProducts } from "@/components/marketplace";

export default function CataloguePage() {
  return (
    <main style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <MarketHeader />
      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "30px auto 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>Marketplace</div>
            <h1 style={{ margin: "8px 0 0", fontSize: "clamp(2.2rem,5vw,4rem)", lineHeight: 1.08 }}>Catalogue vérifié</h1>
          </div>
          <Link href="/boutique/tableau-de-bord" className="f-button f-button--primary">Publier une annonce <ArrowRight size={17} /></Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 0.9fr 0.7fr", gap: 12, background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 22, padding: 14, boxShadow: "var(--sh)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", borderRadius: 16, padding: "0 14px", minHeight: 52 }}>
            <Search size={17} style={{ color: "var(--mut)" }} />
            <input placeholder="Rechercher un modèle, une couleur ou une ville" style={{ width: "100%", border: 0, background: "transparent", color: "var(--ink)", outline: "none", fontSize: 14 }} />
          </label>
          <button type="button" className="f-button f-button--secondary" style={{ justifyContent: "center" }}><Filter size={16} /> Modèle</button>
          <button type="button" className="f-button f-button--secondary" style={{ justifyContent: "center" }}><SlidersHorizontal size={16} /> Filtres</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          {['iPhone 13', '256 Go', 'Bluetooth', 'Biomètre', 'Paiement échelonné', 'Certificat valide'].map((tag) => (
            <span key={tag} style={{ display: "inline-flex", alignItems: "center", padding: "7px 11px", background: "rgba(180,195,115,0.12)", border: "1px solid var(--line)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{tag}</span>
          ))}
        </div>
      </section>

      <section style={{ width: "min(1240px,calc(100% - 32px))", margin: "26px auto 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          {marketProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </main>
  );
}
