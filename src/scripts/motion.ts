// Small, calm motion layered on top of the app. Nothing here changes data or markup that
// app.ts relies on: it only listens to the same clicks and animates what is already rendered.
// Respects prefers-reduced-motion; ?motion=on / ?motion=off overrides it (and is remembered).
import { gsap } from 'gsap';

const KEY = 'sidequest-motion';
function readOverride(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('motion');
    if (q === 'on' || q === 'off') { localStorage.setItem(KEY, q); return q; }
    return localStorage.getItem(KEY);
  } catch { return null; }
}
const override = readOverride();
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => (override === 'on' ? false : override === 'off' ? true : mq.matches);
document.documentElement.dataset.motion = reduced() ? 'off' : 'on';

const ENTER = '.page-heading, .toolbar, .filters, .section-heading, .surface, .plan-tile, .shared-list, .idea-card';

/** Fade the active view's blocks up into place, a few at a time. */
function enterView(view: Element | null) {
  if (!view || reduced()) return;
  const blocks = Array.from(view.querySelectorAll<HTMLElement>(ENTER)).filter((el) => el.offsetParent !== null).slice(0, 18);
  gsap.killTweensOf(blocks);
  gsap.fromTo(blocks, { opacity: 0, y: 12 }, {
    opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.035, clearProps: 'opacity,transform',
  });
  view.querySelectorAll<HTMLElement>('.progress-track span').forEach((bar) => {
    const target = bar.style.width;
    if (!target) return;
    gsap.fromTo(bar, { width: '0%' }, { width: target, duration: 1.1, ease: 'power2.out', delay: 0.15, clearProps: 'width' });
  });
}

/** A short burst of sparks from a checkbox when a task is completed. */
function sparks(from: HTMLElement) {
  if (reduced()) return;
  const r = from.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'spark-layer';
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  document.body.appendChild(layer);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    layer.appendChild(s);
    const angle = (i / n) * Math.PI * 2;
    gsap.set(s, { rotate: (angle * 180) / Math.PI });
    gsap.fromTo(s, { x: 0, y: 0, scaleX: 0.2, opacity: 1 }, {
      x: Math.cos(angle) * 18, y: Math.sin(angle) * 18, scaleX: 1, opacity: 0, duration: 0.5, ease: 'power2.out',
    });
  }
  gsap.fromTo(from, { scale: 0.8 }, { scale: 1, duration: 0.45, ease: 'back.out(3)', clearProps: 'transform' });
  window.setTimeout(() => layer.remove(), 650);
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const nav = target.closest<HTMLElement>('[data-view]');
  if (nav) {
    // app.ts switches the view on this same click; animate once it has.
    requestAnimationFrame(() => enterView(document.querySelector('.view.active-view')));
    return;
  }
  const check = target.closest<HTMLElement>('.check-action');
  if (check) {
    const box = check.querySelector<HTMLElement>('.checkbox');
    if (box && !box.classList.contains('done')) sparks(box);
  }
});

// First paint after sign-in: the Today view fills in once; animate that, then stop watching.
const today = document.querySelector('#view-today');
if (today) {
  const watch = new MutationObserver(() => {
    if (today.querySelector('.surface')) {
      watch.disconnect();
      requestAnimationFrame(() => enterView(document.querySelector('.view.active-view')));
    }
  });
  watch.observe(today, { childList: true });
}
