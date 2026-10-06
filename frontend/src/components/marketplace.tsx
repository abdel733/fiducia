import Link from "next/link";
import { BadgeCheck, CheckCircle2, MapPin, MessageCircle, ShieldCheck, Star } from "lucide-react";

export const marketProducts = [
  {
    id: "iphone-13-pro-max-256-go",
    slug: "iphone-13-pro-max-256-go",
    title: "iPhone 13 Pro Max 256 Go",
    model: "iPhone 13 Pro Max",
    capacity: "256 Go",
    color: "Bleu Alpine",
    status: "Certifié",
    price: 362000,
    priceLabel: "362 000 XOF",
    city: "Cotonou",
    battery: "92%",
    condition: "Excellent",
    seller: "Mobile Cotonou",
    shopSlug: "mobile-cotonou",
    badge: "Certificat actif",
    image: "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=1200&q=80",
    rating: 4.9,
    reviews: 18,
    paymentOptions: ["Cash", "Option A", "Option B"],
  },
  {
    id: "iphone-12-128-go",
    slug: "iphone-12-128-go",
    title: "iPhone 12 128 Go",
    model: "iPhone 12",
    capacity: "128 Go",
    color: "Blanc",
    status: "Disponible",
    price: 285000,
    priceLabel: "285 000 XOF",
    city: "Porto-Novo",
    battery: "95%",
    condition: "Très bon",
    seller: "Bénin iStore",
    shopSlug: "benin-istore",
    badge: "Vendeur vérifié",
    image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80",
    rating: 4.8,
    reviews: 10,
    paymentOptions: ["Cash", "Option A"],
  },
  {
    id: "iphone-13-128-go",
    slug: "iphone-13-128-go",
    title: "iPhone 13 128 Go",
    model: "iPhone 13",
    capacity: "128 Go",
    color: "Noir",
    status: "A vérifier",
    price: 310000,
    priceLabel: "310 000 XOF",
    city: "Parakou",
    battery: "90%",
    condition: "Bon",
    seller: "Phone House",
    shopSlug: "phone-house",
    badge: "Certificat en cours",
    image: "https://images.unsplash.com/photo-1678130798460-6f5a47a0f7d4?auto=format&fit=crop&w=1200&q=80",
    rating: 4.7,
    reviews: 7,
    paymentOptions: ["Cash", "Option A", "Option B"],
  },
  {
    id: "iphone-11-64-go",
    slug: "iphone-11-64-go",
    title: "iPhone 11 64 Go",
    model: "iPhone 11",
    capacity: "64 Go",
    color: "Vert",
    status: "Certifié",
    price: 228000,
    priceLabel: "228 000 XOF",
    city: "Abomey-Calavi",
    battery: "88%",
    condition: "Correct",
    seller: "MobiPlus",
    shopSlug: "mobiplus",
    badge: "Certificat actif",
    image: "https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=1200&q=80",
    rating: 4.8,
    reviews: 12,
    paymentOptions: ["Cash", "Option A"],
  },
] as const;

export const shopProfiles = [
  {
    slug: "mobile-cotonou",
    name: "Mobile Cotonou",
    city: "Cotonou",
    rating: 4.9,
    reviews: 26,
    certificate: "Certificat actif",
    description: "Boutique mobile certifiée, spécialisée sur les iPhone premium avec contrôle d’IMEI et vérification de batterie.",
  },
  {
    slug: "benin-istore",
    name: "Bénin iStore",
    city: "Porto-Novo",
    rating: 4.8,
    reviews: 15,
    certificate: "Certificat actif",
    description: "Vente de téléphones reconditionnés et financement partenaire sur le territoire béninois.",
  },
  {
    slug: "phone-house",
    name: "Phone House",
    city: "Parakou",
    rating: 4.7,
    reviews: 9,
    certificate: "Certificat en cours",
    description: "Service de proximité pour achats sécurisés et démonstrations de qualité avant validation.",
  },
] as const;

function formatXof(value: number) {
  return new Intl.NumberFormat("fr-BJ", { style: "currency", currency: "XOF", maximumFractionDigits: 0 }).format(value);
}

export function MarketHeader() {
  return (
    <header style={{ width: "min(1240px,calc(100% - 32px))", margin: "0 auto", paddingTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, background: "rgba(255,255,255,0.08)", border: "1px solid var(--line)", borderRadius: 999, padding: "10px 14px 10px 18px", boxShadow: "var(--sh)" }}>
        <Link href="/" className="f-brand" aria-label="Accueil Fiducia">
          <span className="f-brand-symbol"><ShieldCheck aria-hidden="true" size={21} /></span>
          <span>Fiducia</span>
        </Link>
        <nav style={{ display: "flex", gap: 10, fontSize: 12, fontWeight: 800, flexWrap: "wrap" }} aria-label="Navigation marketplace">
          <Link href="/" style={{ padding: "10px 12px", borderRadius: 999, opacity: 0.9 }}>Accueil</Link>
          <Link href="/catalogue" style={{ padding: "10px 12px", borderRadius: 999, background: "rgba(180,195,115,0.12)", color: "var(--ink)" }}>Catalogue</Link>
          <Link href="/boutique/tableau-de-bord" style={{ padding: "10px 12px", borderRadius: 999, opacity: 0.9 }}>Boutique</Link>
          <Link href="/compte" style={{ padding: "10px 12px", borderRadius: 999, opacity: 0.9 }}>Compte</Link>
        </nav>
        <Link href="/connexion" className="f-button f-button--primary">Se connecter</Link>
      </div>
    </header>
  );
}

export function ProductCard({ product }: { product: (typeof marketProducts)[number] }) {
  return (
    <article style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 24, overflow: "hidden", boxShadow: "var(--sh)" }}>
      <div style={{ height: 190, backgroundImage: `url(${product.image})`, backgroundSize: "cover", backgroundPosition: "center", position: "relative" }}>
        <div style={{ position: "absolute", inset: "12px 12px auto auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "rgba(13,17,11,0.72)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>
          <BadgeCheck size={12} /> {product.badge}
        </div>
      </div>
      <div style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <span style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>{product.condition}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--ink)", fontSize: 12, fontWeight: 800 }}><MapPin size={12} /> {product.city}</span>
        </div>

        <Link href={`/annonce/${product.slug}`} style={{ color: "var(--ink)", fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>
          {product.title}
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0" }}>
          <Star size={15} fill="currentColor" style={{ color: "var(--acc2)" }} />
          <span style={{ fontSize: 12, fontWeight: 800 }}>{product.rating}</span>
          <span style={{ color: "var(--mut)", fontSize: 11 }}>({product.reviews} avis)</span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ padding: "6px 10px", background: "rgba(180,195,115,0.12)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{product.capacity}</span>
          <span style={{ padding: "6px 10px", background: "rgba(255,189,80,0.12)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{product.color}</span>
          <span style={{ padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{product.battery}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--mut)" }}>Prix</div>
            <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>{formatXof(product.price)}</div>
          </div>
          <Link href={`/annonce/${product.slug}`} className="f-button f-button--secondary">Voir</Link>
        </div>
      </div>
    </article>
  );
}

export function ShopCard({ shop }: { shop: (typeof shopProfiles)[number] }) {
  return (
    <article style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 24, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ color: "var(--mut)", fontSize: 11, fontWeight: 800, letterSpacing: 0.12, textTransform: "uppercase" }}>{shop.city}</div>
          <h3 style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{shop.name}</h3>
        </div>
        <Link href={`/boutique/${shop.slug}`} className="f-button f-button--secondary">Voir la vitrine</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14 }}>
        <ShieldCheck size={16} style={{ color: "var(--acc)" }} />
        <span style={{ fontSize: 12, fontWeight: 800 }}>{shop.certificate}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
        <Star size={15} fill="currentColor" style={{ color: "var(--acc2)" }} />
        <span style={{ fontSize: 12, fontWeight: 800 }}>{shop.rating}</span>
        <span style={{ color: "var(--mut)", fontSize: 11 }}>({shop.reviews} avis)</span>
      </div>
      <p style={{ margin: "12px 0 0", color: "var(--mut)", lineHeight: 1.6 }}>{shop.description}</p>
    </article>
  );
}

export function WhatsAppButton({ phone, message, label = "Contacter sur WhatsApp" }: { phone: string; message: string; label?: string }) {
  const href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="f-button f-button--primary" style={{ gap: 10 }}>
      <MessageCircle size={18} /> {label}
    </a>
  );
}

export function PaymentPlan({ price }: { price: number }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 12 }}>
        <span style={{ color: "var(--mut)", fontSize: 12 }}>Comptant</span>
        <strong style={{ fontSize: 15 }}>{formatXof(price)}</strong>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "rgba(180,195,115,0.12)", borderRadius: 12 }}>
        <span style={{ color: "var(--mut)", fontSize: 12 }}>Option A • 3x</span>
        <strong style={{ fontSize: 15 }}>{formatXof(Math.round(price / 3))}</strong>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "rgba(255,189,80,0.12)", borderRadius: 12 }}>
        <span style={{ color: "var(--mut)", fontSize: 12 }}>Option B • 6x</span>
        <strong style={{ fontSize: 15 }}>{formatXof(Math.round(price / 6))}</strong>
      </div>
    </div>
  );
}

export function TrustPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 999, background: "rgba(255,255,255,0.04)", fontSize: 11, fontWeight: 800 }}>
      {icon}
      {label}
    </div>
  );
}

export function ChecklistItem({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)", fontSize: 13, fontWeight: 700 }}>
      <CheckCircle2 size={16} style={{ color: "var(--acc)" }} />
      {label}
    </div>
  );
}
