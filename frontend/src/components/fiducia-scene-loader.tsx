"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

const fallbackSteps = [
  { number: "01", title: "Saisis ou scanne l’IMEI" },
  { number: "02", title: "On interroge plusieurs sources" },
  { number: "03", title: "Tu reçois un certificat signé" },
];

export function DeferredScrollScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [Scene, setScene] = useState<ComponentType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    const loadScene = (observer?: IntersectionObserver) => {
      observer?.disconnect();
      void import("./fiducia-scroll-scene").then(({ ScrollScene }) => {
        if (active) setScene(() => ScrollScene);
      });
    };
    if (!("IntersectionObserver" in window)) {
      loadScene();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadScene(observer);
    }, { rootMargin: "320px 0px" });
    observer.observe(container);
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, []);

  return <div ref={containerRef}>
    {Scene ? <Scene /> : <section className="f-scroll-scene" aria-label="Les étapes de vérification"><div className="f-step-grid" role="list">
      {fallbackSteps.map((step) => <article className="f-step-card" role="listitem" key={step.number}><span className="f-step-number">{step.number}</span><span className="f-step-title">{step.title}</span></article>)}
    </div></section>}
  </div>;
}