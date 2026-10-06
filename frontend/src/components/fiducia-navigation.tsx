"use client";

import { Menu, Moon, Sun } from "lucide-react";
import Link from "next/link";

export function ThemeToggle() {
  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try { localStorage.setItem("fiducia-theme", nextTheme); } catch {}
  }

  return <button className="f-icon-button f-theme-toggle" type="button" onClick={toggleTheme} aria-label="Basculer le thème clair ou sombre" title="Basculer le thème">
    <Sun className="f-theme-icon f-theme-icon--sun" aria-hidden="true" size={18} />
    <Moon className="f-theme-icon f-theme-icon--moon" aria-hidden="true" size={18} />
  </button>;
}

export function MobileHeader() {
  return <div className="f-mobile-header">
    <ThemeToggle />
    <details className="f-mobile-menu-details">
      <summary className="f-icon-button" aria-label="Ouvrir ou fermer le menu"><Menu aria-hidden="true" size={21} /></summary>
      <nav className="f-mobile-menu" aria-label="Navigation principale">
        <Link href="/" aria-current="page">Accueil</Link><Link href="#verifier">Vérifier</Link>
        <Link href="/certification">Catalogue</Link><Link href="#paiement">Paiement</Link>
        <Link href="/boutique/nouvelle">Partenaires</Link><Link href="#aide">Aide</Link><Link href="/connexion">Connexion</Link>
      </nav>
    </details>
  </div>;
}