"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "./fiducia-components";

const steps = [
  { number: "01", title: "Saisis ou scanne l’IMEI", description: "Avec la caméra de ton téléphone ou en tapant les 15 chiffres." },
  { number: "02", title: "On interroge plusieurs sources", description: "Listes de vol, verrouillage d’activation et cohérence du modèle. Le résultat précise les sources consultées." },
  { number: "03", title: "Tu reçois un certificat signé", description: "À partager et à vérifier par code ou QR lorsqu’un certificat est émis." },
];

const sceneStates = [
  { title: "IMEI à contrôler", text: "La vérification commence à partir de l’identifiant saisi. Aucun certificat n’est encore émis." },
  { title: "Sources consultées", text: "Le résultat dépend des sources effectivement interrogées et de leur disponibilité." },
  { title: "Certificat signé", text: "Un certificat peut être émis après contrôle et validation. Son statut reste vérifiable et révocable." },
];

export function StepCard({ number, title, description, active, onActivate }: { number: string; title: string; description: string; active: boolean; onActivate: () => void }) {
  return <button className={`f-step-card${active ? " is-active" : ""}`} type="button" data-scene-step={number} aria-pressed={active} onClick={onActivate}>
    <span className="f-step-number">{number}</span><span className="f-step-title">{title}</span><span className="f-step-description">{description}</span>
  </button>;
}

export function ScrollScene() {
  const sceneRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const browserNavigator = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
    const connection = browserNavigator.connection;
    const deviceMemory = browserNavigator.deviceMemory;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smallScreen = window.matchMedia("(max-width: 700px)").matches;
    const lowPower = connection?.saveData || connection?.effectiveType?.includes("2g") || (deviceMemory !== undefined && deviceMemory <= 4);
    if (reducedMotion || lowPower || smallScreen) return;

    let frame = 0;
    const updateScene = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        const distance = Math.max(scene.offsetHeight - window.innerHeight, 1);
        const progress = Math.min(0.999, Math.max(0, -scene.getBoundingClientRect().top / distance));
        setActiveStep(Math.min(2, Math.floor(progress * 3)));
        document.documentElement.style.setProperty("--ring-shift", `${Math.min(window.scrollY * 0.035, 32)}px`);
      });
    };
    updateScene();
    window.addEventListener("scroll", updateScene, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateScene);
      document.documentElement.style.removeProperty("--ring-shift");
    };
  }, []);

  const current = sceneStates[activeStep];
  return <section ref={sceneRef} className="f-scroll-scene" aria-label="Les étapes de vérification">
    <div className="f-scene-pin">
      <div className="f-step-grid">
        {steps.map((step, index) => <StepCard key={step.number} {...step} active={activeStep === index} onActivate={() => setActiveStep(index)} />)}
      </div>
      <aside className="f-scene-certificate" aria-live="polite">
        <div className="f-scene-certificate-mark"><Badge>{String(activeStep + 1).padStart(2, "0")} / 03</Badge><span className="f-scene-dash" /></div>
        <span className="f-card-kicker">Parcours de vérification</span>
        <h3 key={current.title}>{current.title}</h3>
        <p>{current.text}</p>
        <div className="f-certificate-seal"><span><span>F</span></span><b>Fiducia</b><small>Certificat vérifiable</small></div>
      </aside>
    </div>
  </section>;
}