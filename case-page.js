(() => {
  const panels = [...document.querySelectorAll(".story-image")];
  if (!panels.length || matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    panels.forEach((panel) => panel.classList.add("is-visible"));
    return;
  }

  document.documentElement.classList.add("motion-ready");
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });

  panels.forEach((panel) => observer.observe(panel));
})();
