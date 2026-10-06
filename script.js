// BOOK MY MOVIE - front end. Talks to the Flask API in app.py (MySQL database).
const PRICE = 150, SEATS = 50;
let tab = 'home', adminPw = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminPw) headers['X-Admin-Password'] = adminPw;
  const res = await fetch('/api' + path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function when(date, time) {
  const d = new Date(date.slice(0, 10) + 'T' + time);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' +
         d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderNav() {
  const tabs = [['home', 'Movies & shows'], ['find', 'My booking'], ['admin', 'Admin']];
  $('nav').innerHTML = tabs.map(t => `<button data-t="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('');
  $('nav').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
}

async function render() {
  renderNav();
  $('view').innerHTML = '<p class="empty">Loading...</p>';
  try {
    await ({ home, find, admin })[tab]();
  } catch (e) {
    $('view').innerHTML = `<div class="msg err">${esc(e.message)} (Is the Flask server running and MySQL connected?)</div>`;
  }
}

/* ---------- Movies & shows ---------- */
async function home() {
  const [movies, shows] = await Promise.all([api('/movies'), api('/shows')]);
  let h = '<h2>Now showing</h2>';
  if (!movies.length) h += '<p class="empty">No movies yet. An admin can add one.</p>';
  movies.forEach(m => {
    const ss = shows.filter(s => s.movie_id === m.movie_id);
    h += `<section class="movie"><h3>${esc(m.movie_name)}</h3>
      <div class="meta">${esc(m.language)} · ${esc(m.genre)} · ${m.duration} min</div>
      <div class="shows">${ss.length
        ? ss.map(s => `<button data-s="${s.show_id}">${when(s.show_date, s.show_time)} &nbsp;(${s.total_seats - s.booked} free)</button>`).join('')
        : '<span class="empty">No shows scheduled.</span>'}</div></section>`;
  });
  $('view').innerHTML = h;
  $('view').querySelectorAll('[data-s]').forEach(b => b.onclick = () => openBooking(shows.find(s => s.show_id === +b.dataset.s)));
}

/* ---------- Booking popup ---------- */
async function openBooking(show) {
  let { booked } = await api(`/shows/${show.show_id}/seats`);
  let sel = [];
  const form = { name: '', phone: '', email: '' };
  const readForm = () => {
    if ($('cn')) { form.name = $('cn').value; form.phone = $('cp').value; form.email = $('ce').value; }
  };

  function draw(err) {
    let seats = '';
    for (let i = 1; i <= SEATS; i++) {
      const n = 'S' + i, taken = booked.includes(n), on = sel.includes(n);
      seats += `<button class="seat${on ? ' sel' : ''}" data-n="${n}"${taken ? ` disabled aria-label="${n} booked"` : ` aria-pressed="${on}"`}>${n}</button>`;
    }
    $('modal').innerHTML = `<div class="modal"><div class="card">
      <h2>${esc(show.movie_name)}</h2><div class="meta">${when(show.show_date, show.show_time)}</div>
      <div class="screen" aria-hidden="true"></div><div class="seats">${seats}</div>
      <div class="legend"><span>Outlined: free</span><span>Filled: yours</span><span>Hatched: booked</span></div>
      ${err ? `<div class="msg err">${esc(err)}</div>` : ''}
      <label for="cn">Name</label><input id="cn" autocomplete="name" value="${esc(form.name)}">
      <div class="row">
        <div><label for="cp">Phone</label><input id="cp" type="tel" autocomplete="tel" value="${esc(form.phone)}"></div>
        <div><label for="ce">Email</label><input id="ce" type="email" autocomplete="email" value="${esc(form.email)}"></div>
      </div>
      <div class="total"><span>${sel.length ? sel.join(', ') : 'No seats selected'}</span><span>₹${sel.length * PRICE}</span></div>
      <div class="row"><button id="close">Close</button><button id="go" class="primary">Book ${sel.length || ''} ticket${sel.length === 1 ? '' : 's'}</button></div>
    </div></div>`;

    document.querySelectorAll('.seat:not([disabled])').forEach(b => b.onclick = () => {
      readForm();
      const n = b.dataset.n, i = sel.indexOf(n);
      i > -1 ? sel.splice(i, 1) : sel.push(n);
      draw();
    });
    $('close').onclick = () => { $('modal').innerHTML = ''; };
    $('go').onclick = async () => {
      readForm();
      if (!sel.length) return draw('Select at least one seat.');
      try {
        const r = await api('/book', { method: 'POST', body: JSON.stringify({ show_id: show.show_id, seats: sel, ...form }) });
        confirmation(show, r);
      } catch (e) {
        try { booked = (await api(`/shows/${show.show_id}/seats`)).booked; sel = sel.filter(n => !booked.includes(n)); } catch (x) { /* ignore */ }
        draw(e.message);
      }
    };
  }
  draw();
}

function ticketHTML(t) {
  return `<div class="ticket"><h3>${esc(t.movie_name)}</h3><div>${when(t.show_date, t.show_time)}</div>
    <dl><dt>Booking ID</dt><dd>${esc(t.ids)}</dd><dt>Name</dt><dd>${esc(t.name)}</dd>
    <dt>Seats</dt><dd>${esc(t.seats)}</dd><dt>Paid</dt><dd>₹${t.amount}</dd>
    ${t.at ? `<dt>Booked on</dt><dd>${new Date(t.at).toLocaleString()}</dd>` : ''}</dl></div>`;
}

function confirmation(show, r) {
  $('modal').innerHTML = `<div class="modal"><div class="card"><h2>Ticket booked</h2>
    ${ticketHTML({ movie_name: show.movie_name, show_date: show.show_date, show_time: show.show_time, name: r.name,
                   ids: r.bookings.map(b => b.booking_id).join(', '), seats: r.bookings.map(b => b.seat_number).join(', '), amount: r.amount })}
    <p class="meta">Keep your Booking ID. You need it to view or cancel a ticket (one ID per seat).</p>
    <button id="done" class="primary">Done</button></div></div>`;
  $('done').onclick = () => { $('modal').innerHTML = ''; render(); };
}

/* ---------- My booking ---------- */
async function find() {
  $('view').innerHTML = `<h2>Find your booking</h2>
    <div class="row" style="max-width:420px"><input id="bid" inputmode="numeric" placeholder="Booking ID" aria-label="Booking ID">
    <button id="look" class="primary" style="flex:0 0 auto">View booking</button></div><div id="res"></div>`;
  $('look').onclick = async () => {
    const id = parseInt($('bid').value, 10);
    try {
      const b = await api('/booking/' + id);
      $('res').innerHTML = ticketHTML({ ...b, ids: b.booking_id, seats: b.seat_number, at: b.booking_date }) + '<button id="cx">Cancel this booking</button>';
      $('cx').onclick = async () => {
        if (!confirm(`Cancel booking ${b.booking_id} (seat ${b.seat_number})? The seat will be released.`)) return;
        try { await api('/booking/' + id, { method: 'DELETE' }); $('res').innerHTML = `<div class="msg">Booking ${id} cancelled.</div>`; }
        catch (e) { $('res').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
      };
    } catch (e) {
      $('res').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    }
  };
}

/* ---------- Admin ---------- */
async function admin() {
  if (!adminPw) {
    $('view').innerHTML = `<h2>Admin login</h2>
      <div class="row" style="max-width:420px"><input id="pw" type="password" placeholder="Admin password" aria-label="Admin password">
      <button id="in" class="primary" style="flex:0 0 auto">Log in</button></div><div id="res"></div>`;
    $('in').onclick = async () => {
      adminPw = $('pw').value;
      try { await api('/admin/bookings'); render(); }
      catch (e) { adminPw = null; $('res').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
    };
    return;
  }
  let movies, bookings;
  try { [movies, bookings] = await Promise.all([api('/movies'), api('/admin/bookings')]); }
  catch (e) { adminPw = null; throw e; }

  const revenue = bookings.reduce((a, b) => a + b.amount, 0);
  const rows = bookings.map(b => `<tr><td>${b.booking_id}</td><td>${esc(b.name)}</td><td>${esc(b.movie_name)}</td>
    <td>${when(b.show_date, b.show_time)}</td><td>${esc(b.seat_number)}</td><td>₹${b.amount}</td></tr>`).join('');

  $('view').innerHTML = `<h2>Admin</h2><div id="res"></div>
    <div class="grid2">
      <form class="box" id="fm"><h3>Add movie</h3>
        <label for="mn">Name</label><input id="mn" required>
        <label for="ml">Language</label><input id="ml" required>
        <label for="mg">Genre</label><input id="mg" required>
        <label for="md">Duration (minutes)</label><input id="md" type="number" min="1" required>
        <p><button class="primary">Add movie</button></p></form>
      <form class="box" id="fs"><h3>Add show</h3>
        <label for="sm">Movie</label><select id="sm">${movies.map(m => `<option value="${m.movie_id}">${esc(m.movie_name)}</option>`).join('')}</select>
        <label for="sd">Date</label><input id="sd" type="date" required>
        <label for="st">Time</label><input id="st" type="time" required>
        <p class="meta">Each show has ${SEATS} seats at ₹${PRICE}.</p>
        <p><button class="primary">Add show</button></p></form>
    </div>
    <h3>All bookings (${bookings.length}) · Revenue ₹${revenue}</h3>
    ${rows ? `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Customer</th><th>Movie</th><th>Show</th><th>Seat</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div>`
           : '<p class="empty">No bookings yet.</p>'}
    <p><button id="out">Log out</button></p>`;

  const post = async (path, body) => {
    try { await api(path, { method: 'POST', body: JSON.stringify(body) }); render(); }
    catch (e) { $('res').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  $('fm').onsubmit = e => { e.preventDefault(); post('/admin/movies', { movie_name: $('mn').value, language: $('ml').value, genre: $('mg').value, duration: $('md').value }); };
  $('fs').onsubmit = e => { e.preventDefault(); post('/admin/shows', { movie_id: $('sm').value, show_date: $('sd').value, show_time: $('st').value }); };
  $('out').onclick = () => { adminPw = null; render(); };
}

render();
