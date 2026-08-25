const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;

const boot = document.querySelector('[data-boot]');
const bootStatus = document.querySelector('[data-boot-status]');
const flash = document.querySelector('[data-signal-flash]');
const header = document.querySelector('[data-header]');
const hero = document.querySelector('[data-hero]');
const tracking = document.querySelector('[data-tracking]');
const trackingCopy = document.querySelector('[data-tracking-copy]');
const unknownFigure = document.querySelector('[data-unknown-figure]');
const signalStrength = document.querySelector('[data-signal-strength]');
const menuButton = document.querySelector('[data-menu-button]');
const mobileMenu = document.querySelector('[data-mobile-menu]');
const abortButton = document.querySelector('[data-abort]');

function signalHit() {
  if (!flash || reduceMotion) return;
  flash.classList.remove('hit');
  void flash.offsetWidth;
  flash.classList.add('hit');
}

function runBoot() {
  if (!boot) return;
  const repeatVisit = sessionStorage.getItem('rs-site-booted') === '1';
  if (reduceMotion || repeatVisit) {
    boot.classList.add('is-done');
    return;
  }

  const states = [
    ['VIDEO LINK // CONNECTED', 280],
    ['AUDIO LINK // CONNECTED', 310],
    ['SIGNAL // ...', 390],
    ['SIGNAL // UNKNOWN', 420],
  ];

  let elapsed = 220;
  for (const [copy, delay] of states) {
    elapsed += delay;
    window.setTimeout(() => {
      if (bootStatus) bootStatus.textContent = copy;
      if (copy === 'SIGNAL // UNKNOWN') signalHit();
    }, elapsed);
  }

  window.setTimeout(() => {
    boot.classList.add('is-done');
    sessionStorage.setItem('rs-site-booted', '1');
  }, elapsed + 420);
}

function updateHeader() {
  header?.classList.toggle('is-scrolled', window.scrollY > 24);
}

function setupHeroTracking() {
  if (!hero || !tracking || !finePointer || reduceMotion) return;
  let moveCount = 0;
  let revealTriggered = false;
  let lastX = 0;
  let lastY = 0;

  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    hero.style.setProperty('--mx', ((x - 0.5) * 2).toFixed(3));
    hero.style.setProperty('--my', ((y - 0.5) * 2).toFixed(3));

    const speed = Math.hypot(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
    if (speed > 4) moveCount += 1;

    tracking.style.transform = `translate3d(${event.clientX - rect.left - 55}px, ${event.clientY - rect.top - 38}px, 0)`;
    tracking.classList.add('is-active');

    if (moveCount > 8 && trackingCopy.textContent === 'MOVEMENT DETECTED') {
      trackingCopy.textContent = 'TARGET: UNKNOWN';
    }
    if (moveCount > 18 && trackingCopy.textContent === 'TARGET: UNKNOWN') {
      trackingCopy.textContent = 'SIGNAL SOURCE: USER';
    }
    if (moveCount > 24 && !revealTriggered) {
      revealTriggered = true;
      unknownFigure?.classList.add('is-visible');
      signalHit();
      window.setTimeout(() => unknownFigure?.classList.remove('is-visible'), 110);
      window.setTimeout(() => tracking.classList.remove('is-active'), 380);
    }
  });

  hero.addEventListener('pointerleave', () => {
    tracking.classList.remove('is-active');
    hero.style.setProperty('--mx', '0');
    hero.style.setProperty('--my', '0');
  });
}

function setupSignalStrength() {
  if (!signalStrength || reduceMotion) return;
  const values = [87, 87, 88, 86, 87, 43, 91, 87];
  let index = 0;
  window.setInterval(() => {
    index = (index + 1) % values.length;
    signalStrength.textContent = `SIGNAL STRENGTH ${values[index]}%`;
    if (values[index] < 50) signalHit();
  }, 4200);
}

function setupMobileMenu() {
  if (!menuButton || !mobileMenu) return;
  const setOpen = (open) => {
    mobileMenu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.textContent = open ? 'CLOSE' : 'COMMAND';
    document.body.style.overflow = open ? 'hidden' : '';
  };

  menuButton.addEventListener('click', () => setOpen(mobileMenu.hidden));
  mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !mobileMenu.hidden) setOpen(false);
  });
}

function setupAbort() {
  if (!abortButton) return;
  let changed = false;
  const deny = () => {
    if (!changed) {
      changed = true;
      abortButton.textContent = 'ABORT UNAVAILABLE';
      signalHit();
    }
  };
  abortButton.addEventListener('mouseenter', deny, { once: true });
  abortButton.addEventListener('click', deny);
  abortButton.addEventListener('focus', deny, { once: true });
}

function setupSectionInterference() {
  if (reduceMotion) return;
  const intel = document.querySelector('#intelligence');
  if (!intel) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
        signalHit();
        observer.disconnect();
      }
    }
  }, { threshold: [0.55] });
  observer.observe(intel);
}

runBoot();
updateHeader();
setupHeroTracking();
setupSignalStrength();
setupMobileMenu();
setupAbort();
setupSectionInterference();
window.addEventListener('scroll', updateHeader, { passive: true });
