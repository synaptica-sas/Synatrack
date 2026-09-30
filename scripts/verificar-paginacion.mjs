/**
 * Comprobación de la paginación en un navegador real.
 *
 * Existe porque este defecto NO lo detectan las pruebas automáticas ni las
 * comprobaciones contra la API: el servidor devolvía la página 2 correctamente,
 * pero la interfaz volvía sola a la 1 y el paginador quedaba clavado. Solo se ve
 * pulsando el botón.
 *
 * Requiere la app levantada (`.\scripts\dev.ps1`) y el paquete `playwright`
 * instalado (no es dependencia del proyecto; se instala aparte cuando hace
 * falta). Uso:
 *
 *   node scripts/verificar-paginacion.mjs [directorio-de-capturas]
 */
const OUT = process.argv[2];
const fallos = [], notas = [];
const chk = (ok, msg) => { (ok ? notas : fallos).push((ok?'OK  ':'FALLO ')+msg); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
ctx.addInitScript(() => sessionStorage.setItem('bypass_auth','true'));
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });

async function ir(path){ await p.goto('http://localhost:5173'+path,{waitUntil:'networkidle'}); await p.waitForTimeout(1200); }

// ---------- Aprobaciones ----------
await ir('/timesheet');
// abrir sub-pestaña Aprobaciones si existe
for (const t of ['Aprobaciones','Aprobación','Approvals']) {
  const el = p.locator(`text="${t}"`).first();
  if (await el.count() && await el.isVisible()) { await el.click(); await p.waitForTimeout(1500); break; }
}
const pagerTxt = async () => (await p.locator('.table-pager__status').first().innerText().catch(()=>'')) || '';
let st = await pagerTxt();
chk(!!st, `Aprobaciones: paginador visible -> "${st}"`);
chk(/\d/.test(st), 'Aprobaciones: el paginador muestra números (total/páginas)');

const filas = async () => p.locator('table tbody tr').count();
const f1 = await filas();
const firstCellP1 = await p.locator('table tbody tr').first().innerText().catch(()=>'');
chk(f1>0, `Aprobaciones: página 1 con ${f1} filas`);

// siguiente página
const nav = p.locator('.table-pager__nav button');
const nNav = await nav.count();
chk(nNav>=2, `Aprobaciones: botones de navegación presentes (${nNav})`);
if (nNav>=2) {
  await nav.last().click(); await p.waitForTimeout(1500);
  const f2 = await filas();
  const firstCellP2 = await p.locator('table tbody tr').first().innerText().catch(()=>'');
  chk(firstCellP2 !== firstCellP1, 'Aprobaciones: al pasar de página cambian las filas');
  const st2 = await pagerTxt();
  chk(st2 !== st, `Aprobaciones: el estado del paginador avanza -> "${st2}"`);
  notas.push(`    (página 2: ${f2} filas)`);
}

// filtro -> vuelve a página 1
const sel = p.locator('select').filter({ hasText: /Todos|Pendiente|Aprobad/ }).first();
let hayFiltro = await sel.count();
if (!hayFiltro) { const s2 = p.locator('.ts-approvals-filter select').first(); hayFiltro = await s2.count(); }
if (hayFiltro) {
  const target = (await sel.count()) ? sel : p.locator('.ts-approvals-filter select').first();
  const opts = await target.locator('option').allTextContents();
  const ap = opts.find(o=>/Aprobad/i.test(o));
  if (ap) {
    await target.selectOption({ label: ap }); await p.waitForTimeout(1800);
    const st3 = await pagerTxt();
    chk(/página 1|pagina 1|página\s*1/i.test(st3), `Aprobaciones: al filtrar vuelve a la página 1 -> "${st3}"`);
  } else notas.push('    (no se encontró opción "Aprobadas")');
} else chk(false,'Aprobaciones: no se encontró el selector de estado');

// ---------- Horas Extra ----------
await ir('/extra-hours');
for (const t of ['Historial','Solicitudes']) {
  const el = p.locator(`text="${t}"`).first();
  if (await el.count() && await el.isVisible()) { await el.click(); await p.waitForTimeout(1500); break; }
}
const stE = await pagerTxt();
chk(!!stE, `Horas Extra: paginador visible -> "${stE}"`);

chk(errs.length===0, `Consola sin errores (${errs.length})`);
if (errs.length) notas.push('    '+errs.slice(0,3).join(' | '));

// capturas claro/oscuro
await ir('/timesheet');
for (const t of ['Aprobaciones','Aprobación']) { const el=p.locator(`text="${t}"`).first(); if(await el.count()&&await el.isVisible()){await el.click();await p.waitForTimeout(1500);break;} }
await p.screenshot({ path: OUT+'/paginacion-aprobaciones-claro-desktop.png', fullPage:true });
await p.evaluate(()=>document.body.classList.add('dark')); await p.waitForTimeout(600);
await p.screenshot({ path: OUT+'/paginacion-aprobaciones-oscuro-desktop.png', fullPage:true });
await p.setViewportSize({width:400,height:850}); await p.waitForTimeout(800);
await p.screenshot({ path: OUT+'/paginacion-aprobaciones-oscuro-movil.png', fullPage:true });

await b.close();
console.log(notas.join('\n'));
console.log('\n=== FALLOS ('+fallos.length+') ===');
console.log(fallos.join('\n') || 'ninguno');
