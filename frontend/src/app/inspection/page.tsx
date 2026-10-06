import Link from "next/link";
import { ArrowRight, Camera, CheckCircle2 } from "lucide-react";

export default function InspectionPage() {
  return (
    <main className="page-shell">
      <section className="card card-lg">
        <span className="eyebrow">INSPECTION</span>
        <h1>Contrôle de l’iPhone avant certification</h1>
        <p>Le vendeur ou l’agent remplit la checklist, les photos et le score de conformité.</p>
        <div className="checklist-grid">
          <label><input type="checkbox" checked readOnly /> Écran d’origine</label>
          <label><input type="checkbox" checked readOnly /> Batterie {'>'} 80%</label>
          <label><input type="checkbox" checked readOnly /> Caméras et haut-parleurs</label>
          <label><input type="checkbox" checked readOnly /> Ports et boutons</label>
        </div>
        <div className="photo-strip">
          <span><Camera size={18} /> Photo avant</span>
          <span><Camera size={18} /> Photo arrière</span>
          <span><Camera size={18} /> Ports</span>
        </div>
        <div className="status-panel status-ok">
          <CheckCircle2 size={18} />
          <div>
            <strong>Score 94/100</strong>
            <p>Le statut issu de l’inspection est conforme pour une certification.</p>
          </div>
        </div>
        <Link className="button button-dark" href="/certification">Passer à la certification <ArrowRight size={16} /></Link>
      </section>
    </main>
  );
}
