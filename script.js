const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

const menuBtn = document.querySelector('.menu-btn');
const mobileMenu = document.querySelector('.mobile-menu');
if (menuBtn && mobileMenu) {
  menuBtn.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    mobileMenu.hidden = false;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (!open) mobileMenu.hidden = true;
  });
  mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    mobileMenu.hidden = true;
    menuBtn.setAttribute('aria-expanded','false');
  }));
}

const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 }) : null;

document.querySelectorAll('.reveal').forEach(el => {
  if (io) io.observe(el); else el.classList.add('visible');
});

const form = document.getElementById('vehicle-form');
const status = document.getElementById('form-status');
if (form && status) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'form-status';
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    status.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    data.consent = Boolean(form.querySelector('[name="consent"]').checked);
    try {
      const response = await fetch('/api/inquiry', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to send your request right now.');
      form.reset();
      const qty = form.querySelector('[name="quantity"]');
      if (qty) qty.value = 1;
      status.className = 'form-status success';
      status.textContent = 'Thank you. Your vehicle request has been sent.';
    } catch (err) {
      status.className = 'form-status error';
      status.innerHTML = 'The form could not send automatically. Please email <a href="mailto:hekmat.h@div3rsa.com">hekmat.h@div3rsa.com</a>.';
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}
