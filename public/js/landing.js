// Landing por tenant. Claude Code: hidratar TENANT_* y consumir /api/public/:slug/menu
const cart = [];
const fmt = (n) => '$' + n.toLocaleString('es-AR');

async function loadMenu() {
  const slug = document.body.dataset.slug || location.pathname.split('/')[1];
  const grid = document.getElementById('menuGrid');
  try {
    const res = await fetch(`/api/public/${slug}/menu`);
    const items = await res.json();
    grid.innerHTML = items.map(dishCard).join('');
    grid.querySelectorAll('[data-id]').forEach((el) =>
      el.addEventListener('click', () => addToCart(items.find((i) => i._id === el.dataset.id))));
  } catch {
    grid.innerHTML = '<p>No pudimos cargar el menú. Probá de nuevo en un momento.</p>';
  }
}

function dishCard(d) {
  return `<article class="dish" data-id="${d._id}">
    ${d.photo ? `<img class="dish__img" src="${d.photo}" alt="${d.name}">` : '<div class="dish__img"></div>'}
    <div class="dish__body">
      <div class="dish__name">${d.name}</div>
      <p class="dish__desc">${d.description || ''}</p>
      <div class="dish__price">${fmt(d.price)}</div>
    </div></article>`;
}

function addToCart(dish) {
  cart.push(dish);
  const total = cart.reduce((s, d) => s + d.price, 0);
  document.getElementById('cartCount').textContent = cart.length;
  document.getElementById('cartTotal').textContent = fmt(total);
  document.getElementById('cart').hidden = false;
}

// Enviar pedido → backend crea Order (channel: landing) y notifica WhatsApp del comercio
document.getElementById('cartSend')?.addEventListener('click', async () => {
  const slug = document.body.dataset.slug || location.pathname.split('/')[1];
  await fetch(`/api/public/${slug}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: cart.map((d) => ({ productId: d._id, qty: 1 })) }),
  });
  alert('¡Pedido enviado! Te escribimos por WhatsApp para confirmar.');
});

loadMenu();
