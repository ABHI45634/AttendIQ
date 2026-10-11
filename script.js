'use strict';

/* ---------- Pure calculation helpers (also used by the tests) ---------- */
const EPS = 1e-9;
const percent = (a, t) => (t > 0 ? (a / t) * 100 : 0);

function project(attended, total, attend, skip) {
  const A = attended + attend;
  const T = total + attend + skip;
  return { attended: A, total: T, pct: percent(A, T) };
}

// Most lectures that can be skipped in a row while staying >= target.
// Returns -1 if already below target, Infinity if target is 0.
function skipBuffer(a, t, target) {
  if (target <= 0) return Infinity;
  if (100 * a < target * t - EPS) return -1;
  if (t === 0) return 0;
  return Math.max(0, Math.floor((100 * a - target * t) / target + EPS));
}

// Fewest lectures to attend in a row to reach target.
// Returns 0 if already there, Infinity if impossible (target >= 100 with a < t).
function attendNeeded(a, t, target) {
  if (100 * a >= target * t - EPS) return 0;
  if (target >= 100) return Infinity;
  return Math.ceil((target * t - 100 * a) / (100 - target) - EPS);
}

function buildInsights(a, t, target, sim) {
  const out = [];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (t === 0) {
    return [{ type: 'info', title: 'No lectures yet', text: 'Enter lectures conducted and attended to see insights.' }];
  }
  const cur = percent(a, t);
  const gap = Math.abs(cur - target).toFixed(2);
  const below = 100 * a < target * t - EPS;

  if (below) out.push({ type: 'bad', title: 'Below target', text: `You're ${gap} points under ${target}%.` });
  else if (Math.abs(cur - target) < 1e-9) out.push({ type: 'warn', title: 'Exactly on target', text: 'No room to spare. Missing one lecture drops you below.' });
  else out.push({ type: 'good', title: 'Above target', text: `You're ${gap} points over ${target}%.` });

  const buf = skipBuffer(a, t, target);
  if (buf === Infinity) out.push({ type: 'good', title: 'No limit on skipping', text: 'A 0% target can never be missed.' });
  else if (buf >= 0) out.push({ type: buf === 0 ? 'warn' : 'good', title: `Can skip ${plural(buf, 'lecture')}`, text: buf === 0 ? 'Attend the next lectures to build a buffer.' : `Skip up to ${buf} in a row and stay at ${target}% or more.` });

  const need = attendNeeded(a, t, target);
  if (below) {
    out.push(need === Infinity
      ? { type: 'bad', title: 'Target not reachable', text: `Once a lecture is missed, ${target}% can't be reached again.` }
      : { type: 'bad', title: `Attend ${plural(need, 'lecture')} in a row`, text: `That brings you back to ${target}%.` });
  }

  if (sim.attend + sim.skip > 0) {
    const p = project(a, t, sim.attend, sim.skip);
    const d = p.pct - cur;
    if (100 * p.attended < target * p.total - EPS) {
      const n = attendNeeded(p.attended, p.total, target);
      out.push({ type: 'bad', title: 'Plan drops you below target', text: n === Infinity ? 'This plan makes the target unreachable.' : `You'd be at ${p.pct.toFixed(2)}%. Attend ${plural(n, 'more lecture')} after this plan to recover.` });
    } else if (d > 1e-9) {
      out.push({ type: 'good', title: 'Plan improves attendance', text: `Up ${d.toFixed(2)} points to ${p.pct.toFixed(2)}%.` });
    } else if (d < -1e-9) {
      out.push({ type: 'warn', title: 'Plan lowers attendance', text: `Down ${Math.abs(d).toFixed(2)} points, still above target at ${p.pct.toFixed(2)}%.` });
    }
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { percent, project, skipBuffer, attendNeeded, buildInsights };

/* ---------- UI ---------- */
if (typeof document !== 'undefined') (function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'attendiq:v1';
  const DEFAULTS = { total: 90, attended: 72, target: 75 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = ['total', 'attended', 'target', 'attendRange', 'attendNum', 'skipRange', 'skipNum'].reduce((o, k) => (o[k] = $(k), o), {});

  const toInt = (v, max = Infinity) => Math.min(max, Math.max(0, Math.floor(Number(v)) || 0));
  const toTarget = (v) => Math.min(100, Math.max(0, Number(v) || 0));

  // Smoothly count a number element to a new value.
  function tween(el, to, digits = 1) {
    const from = parseFloat(el.dataset.v);
    el.dataset.v = to;
    if (reduce || isNaN(from)) { el.textContent = to.toFixed(digits); return; }
    cancelAnimationFrame(el._raf);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(digits);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function setRing(el, pct) {
    const c = 2 * Math.PI * el.r.baseVal.value;
    el.style.strokeDasharray = c;
    el.style.strokeDashoffset = c * (1 - Math.min(100, pct) / 100);
  }

  function readState() {
    const total = toInt(els.total.value);
    const rawAtt = toInt(els.attended.value);
    const attended = Math.min(rawAtt, total);
    return { total, attended, rawAtt, target: toTarget(els.target.value),
             attend: toInt(els.attendNum.value), skip: toInt(els.skipNum.value) };
  }

  function render() {
    const s = readState();
    const invalid = s.rawAtt > s.total;
    els.attended.classList.toggle('invalid', invalid);
    els.attended.setAttribute('aria-invalid', invalid);
    $('err').textContent = invalid ? `Attended (${s.rawAtt}) can't be more than conducted (${s.total}). Using ${s.attended} for now.` : '';

    const cur = percent(s.attended, s.total);
    const p = project(s.attended, s.total, s.attend, s.skip);
    const delta = p.pct - cur;

    tween($('curPct'), cur);
    $('curCount').textContent = `${s.attended} of ${s.total} lectures attended`;
    $('chipMissed').textContent = `${s.total - s.attended} missed`;
    $('chipTarget').textContent = `Target ${s.target}%`;
    $('curBar').style.width = cur + '%';
    $('curBar').classList.toggle('below', s.total > 0 && cur < s.target - EPS);
    $('curBarA11y').setAttribute('aria-label', `Current attendance ${cur.toFixed(1)} percent, target ${s.target} percent`);

    tween($('projPct'), p.pct);
    $('projCount').textContent = `${p.attended} of ${p.total} lectures`;
    const d = $('delta');
    d.textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(2)} pts`;
    d.className = 'delta ' + (delta > 1e-9 ? 'up' : delta < -1e-9 ? 'down' : 'flat');
    $('legCur').textContent = cur.toFixed(2) + '%';
    $('legProj').textContent = p.pct.toFixed(2) + '%';
    setRing($('ringCur'), cur); setRing($('ringProj'), p.pct);
    $('cmpCur').style.width = cur + '%';
    $('cmpProj').style.width = p.pct + '%';
    $('cmpProj').classList.toggle('below', p.total > 0 && p.pct < s.target - EPS);
    $('cmpCur').classList.toggle('below', s.total > 0 && cur < s.target - EPS);
    ['curTick', 'cmpTick1', 'cmpTick2'].forEach((id) => ($(id).style.left = s.target + '%'));

    const list = $('insights');
    list.innerHTML = '';
    buildInsights(s.attended, s.total, s.target, s).forEach((i) => {
      const li = document.createElement('li');
      li.className = i.type + ' pop';
      li.innerHTML = '<span class="ic" aria-hidden="true"></span><div><strong></strong><span class="t"></span></div>';
      li.querySelector('.ic').textContent = { good: '✓', warn: '!', bad: '✕', info: 'i' }[i.type];
      li.querySelector('strong').textContent = i.title;
      li.querySelector('.t').textContent = i.text;
      list.appendChild(li);
    });
    save();
  }

  /* persistence */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ total: els.total.value, attended: els.attended.value, target: els.target.value,
        theme: document.documentElement.dataset.theme }));
    } catch (e) { /* storage unavailable: app still works */ }
  }
  function load() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
    els.total.value = d.total ?? DEFAULTS.total;
    els.attended.value = d.attended ?? DEFAULTS.attended;
    els.target.value = d.target ?? DEFAULTS.target;
    if (d.theme) setTheme(d.theme);
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
    $('themeBtn').setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} theme`);
  }
  const resetSim = () => { ['attendRange', 'attendNum', 'skipRange', 'skipNum'].forEach((k) => (els[k].value = 0)); };
  const resetCurrent = () => { Object.keys(DEFAULTS).forEach((k) => (els[k].value = DEFAULTS[k])); };

  /* wiring: slider and number box stay in sync */
  [['attendRange', 'attendNum'], ['skipRange', 'skipNum']].forEach(([r, n]) => {
    els[r].addEventListener('input', () => { els[n].value = els[r].value; render(); });
    els[n].addEventListener('input', () => { els[r].value = Math.min(toInt(els[n].value), els[r].max); render(); });
  });
  ['total', 'attended', 'target'].forEach((k) => els[k].addEventListener('input', render));
  els.attended.addEventListener('blur', () => { els.attended.value = readState().attended; render(); });

  $('resetSimBtn').onclick = () => { resetSim(); render(); };
  $('resetAllBtn').onclick = () => { resetCurrent(); resetSim(); render(); };
  $('clearBtn').onclick = () => {
    if (!confirm('Remove saved attendance data from this device?')) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    resetCurrent(); resetSim(); setTheme('dark'); render();
    try { localStorage.removeItem(KEY); } catch (e) {} // render() re-saves; remove again so nothing stays stored
  };
  $('themeBtn').onclick = () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); save(); };

  load();
  render();
})();
