// Shared motion for the landing and catalog pages: Lenis smooth scroll driven by GSAP's ticker, scroll reveals,
// magnetic buttons and the header's glass state. Smooth scroll, reveals and magnets are skipped under reduced motion.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const header = document.querySelector<HTMLElement>(".site-header");
const onScroll = () => header?.classList.toggle("scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

if (!reduced) {
  const lenis = new Lenis({ lerp: 0.09, anchors: { offset: -72 } });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
    gsap.to(el, {
      opacity: 1, y: 0, duration: 1.1, ease: "expo.out", delay: Number(el.dataset.reveal) || 0,
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  }

  // Buttons lean toward the cursor a little.
  for (const el of document.querySelectorAll<HTMLElement>(".magnetic")) {
    const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
    const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
    el.addEventListener("pointermove", e => {
      const r = el.getBoundingClientRect();
      x((e.clientX - r.left - r.width / 2) * 0.28);
      y((e.clientY - r.top - r.height / 2) * 0.38);
    });
    el.addEventListener("pointerleave", () => { x(0); y(0); });
  }
}

// Pinned sections measure images; measure again once everything has loaded.
addEventListener("load", () => ScrollTrigger.refresh());
