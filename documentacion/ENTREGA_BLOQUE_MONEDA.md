# Entrega — Bloque de Moneda, Horas Extra y Gastos

**Responsable:** Juan Mahecha · **Periodo:** 5–6 de octubre de 2026 · **Rama:** `dev`

Los siete ítems del bloque quedaron cerrados. Este documento recoge qué se hizo en cada uno, por
qué se hizo así, y qué quedó deliberadamente fuera.

| Ítem | Qué pedía | Estado |
|---|---|---|
| R-008 + R-012 | Convertir con la tasa de la fecha del contrato | Hecho |
| R-020 + R-022 | Resumen semanal al PM en vez de aviso por solicitud | Hecho |
| R-024 | La delegación falla diciendo que el correo no existe | Hecho (deja D-13) |
| R-025 | Categorías de capacitación y horas extra en Gastos | Resuelto de rebote |
| R-026 | Gastos siempre en USD, y la conversión no coincide | Hecho |
| R-027 | Buscar proyecto como lista desplegable | Hecho |

**Resultado medible:** las pruebas automáticas pasaron de 824 a **873**. Ninguna migración
destructiva. Cinco decisiones de negocio levantadas y documentadas en vez de resueltas por
cuenta propia.

---

## 1. La conversión de moneda usa la tasa de la fecha (R-008 + R-012)

### El problema

Todo el cálculo financiero convertía con la tasa **del día en que se consultaba**. Un gasto de
marzo se valoraba con la tasa de octubre, y el presupuesto de un contrato firmado hace un año se
reexpresaba cada mañana. **Los números cambiaban solos aunque nadie tocara nada.**

### Qué se hizo

Cada importe se convierte ahora con la tasa que le corresponde por fecha. La asignación de fechas
se razonó y quedó escrita en el propio código:

| Concepto | Se valora a | Por qué |
|---|---|---|
| Presupuesto y precio de venta | Inicio del proyecto | Son valores pactados una vez, no movimientos |
| Gastos e ingresos | Su fecha de registro | Es la fecha del hecho económico |
| Costo de las horas | El día de cada registro, uno por uno | Promediar el mes inventaría una fecha que nadie eligió |

**El rendimiento no se resintió:** el histórico se carga una vez por petición y la tasa vigente se
resuelve con búsqueda binaria, memorizando el resultado por día. Cero consultas adicionales
respecto de antes.

### Efecto medido

El presupuesto de *Migración Cloudera a Azure* pasa de 121.519 a **111.628 USD** al valorarse con
la tasa de mayo, cuando arrancó el contrato. Pero lo que importa no es la cifra: **deja de
moverse**.

### Lo que queda abierto

**D-10** y **D-11**, ambas de negocio. La primera pregunta si la fecha de contrato es realmente la
de inicio del proyecto y si los ingresos se valoran a factura o a cobro — cualquiera de las dos
alternativas exige un campo nuevo, porque hoy no existe. La segunda, si se carga el histórico de
tasas hacia atrás: hoy solo hay cinco registros de un único día, así que en la práctica casi todo
sigue cayendo a la tasa actual. **La diferencia es que ahora la aplicación lo admite en pantalla
en vez de callarlo.**

---

## 2. El PM recibe un resumen semanal de lo que tiene por aprobar (R-020 + R-022)

### El problema

En horas extra, cada solicitud generaba un correo. En horas regulares **no había ningún aviso**:
el PM tenía que acordarse de mirar.

### Qué se hizo

Un solo correo semanal por PM, con sus horas y sus horas extra juntas. Se construyeron los dos
ítems a la vez porque son el mismo mecanismo visto desde dos lados.

**No se inventó un planificador.** El ciclo horario que ya existía gana un trabajo más, puesto el
último de la lista a propósito: solo observa, así que un fallo suyo no retrasa el motor de
alertas. La periodicidad la da una marca en la base: el trabajo corre 168 veces por semana y en
167 decide que todavía no toca.

**El envío duplicado se evita reclamando la semana con una escritura condicional antes de
enviar**, que en la base de datos es atómica. Eso funciona incluso con dos instancias del
servidor. Se reclama *antes* de enviar a sabiendas: si el envío falla se pierde esa semana, pero
un aviso repetido cada hora durante siete días es exactamente el ruido que se quería eliminar.

### Decisiones de diseño que conviene conocer

- **A quien no tiene nada pendiente no se le escribe.** Un "no tienes nada" semanal entrena a la
  gente a ignorar al remitente, y mata la señal que se está añadiendo.
- **El correo no lleva importes.** Es un recordatorio de aprobación, no un documento de nómina;
  incluir montos arrastraría la tarifa del consultor a un canal sin control de acceso.
- **El aviso inmediato de horas extra queda apagado, no borrado.** Está detrás de un interruptor
  configurable: si resulta que para una urgencia esperar al lunes no sirve, recuperarlo es un clic
  y no un despliegue.

### Lo que queda abierto

**D-12:** la hora de envío se evalúa en horario universal, así que un PM fuera de la franja de
Colombia lo recibiría a otra hora.

---

## 3. La delegación de aprobación ya acepta a cualquier consultor (R-024)

### El problema, que era peor de lo reportado

Al delegar, el sistema exigía que esa persona tuviera cuenta de usuario, y **la cuenta solo nace
cuando alguien inicia sesión por primera vez**. Como el desplegable se rellena con la lista de
consultores, **el formulario ofrecía exactamente las opciones que el sistema rechazaba**. No era
un caso raro: en la base de ejemplo, ninguno de los cuatro consultores podía ser delegado.

El mensaje tampoco ayudaba: decía que el correo no estaba registrado, lo que suena a error de
tipeo cuando se acaba de elegir de una lista.

### Qué se hizo

La búsqueda mira también entre los consultores, sin distinguir mayúsculas. El mensaje de error
ahora dice dónde se buscó.

### Lo que NO se hizo, y es lo importante

**El delegado sigue sin poder aprobar.** Los endpoints de aprobación solo admiten los roles
Administrador y PM, así que un consultor recibe un rechazo antes de que el sistema mire siquiera
si tiene delegación vigente.

Se comprobó que **basta una línea** para que funcione — se probó, no se dedujo — y **no se tocó**,
porque esa línea amplía quién puede autorizar el pago de horas extra, y eso no lo decide
desarrollo. Queda como **D-13**, con una prueba que fija el comportamiento actual y un aviso en la
pantalla para que nadie lo descubra fallando.

---

## 4. Gastos muestra los mismos números que el resto del producto (R-026, R-027, R-025)

### El problema

Tres cosas distintas en la misma pantalla:

1. **La moneda** se fijaba siempre en dólares, sin mirar la del proyecto.
2. **La conversión se hacía en el navegador con las tasas de hoy**, mientras el resto del producto
   ya usaba la tasa de cada fecha. Los totales de Gastos podían no cuadrar con los del Tablero
   **para los mismos gastos**.
3. **El buscador de proyecto** era texto libre, a diferencia del resto de pantallas.

### Qué se hizo

La moneda sale del proyecto cuando los gastos visibles comparten una. El buscador pasa al mismo
desplegable que ya usaban Portafolio y Proyectos, sin crear un componente nuevo.

Y la conversión **se movió al servidor**, importe a importe: el cliente solo suma, filtra y
agrupa. Se descartó replicar el cálculo en el navegador porque habría sido una segunda
implementación de lo mismo — la enfermedad que este proyecto lleva semanas curando, con tres
cálculos de rentabilidad distintos y umbrales duplicados con valores diferentes. Para que fuera
literalmente *una sola* implementación, se extrajo la función de conversión y el resto del
producto pasa ahora por ella.

### La comprobación que importa

Los mismos doce gastos dan **8.278,48 USD en Gastos y en el Tablero**. Antes, con histórico de
tasas cargado, la diferencia era de **649,90 USD — un 8,5 %**. Estaba latente e invisible porque
la base solo tenía tasas de un día.

### De regalo

**R-025** se cerró sin tocarlo: al llevar las categorías de gasto a un catálogo editable
(decisión D-4), "Capacitación" apareció sola —estaba en uso sin figurar en la lista del código— y
"Horas extra" se añade desde la pantalla sin desplegar.

### Lo que queda abierto

**D-14:** el porcentaje de ejecución presupuestal divide cifras convertidas con criterios
distintos. Y un defecto aparte, que no es decisión sino error: el indicador "Presupuesto
(proyectos filtrados)" **suma monedas distintas sin convertir** — hoy rotula una suma de pesos
como dólares.

---

## 5. Defectos encontrados de paso

Ninguno estaba en el encargo; aparecieron al trabajar y se corrigieron o se anotaron:

| Qué | Dónde | Estado |
|---|---|---|
| Las fechas se mostraban **un día antes** (se interpretaban en hora local lo que el sistema fecha en universal) | Gastos | Corregido — habría llegado a afirmar que se usó la tasa de un día equivocado |
| El texto compartido del aviso de conversión concordaba en femenino para tres llamadores masculinos | Cuatro pantallas | Corregido |
| La dona de "Gastos por categoría" suma importes crudos entre monedas | Tablero | **Anotado, no tocado**: arreglarlo cambiaría cifras que el Tablero muestra hoy |
| Ningún proyecto tenía Project Manager asignado | Todos | Asignados en la base de ejemplo; el formulario existía hace semanas, era un dato sin rellenar |

---

## 6. Lo que no se pudo verificar

Con franqueza, porque condiciona lo que se puede afirmar:

- **El envío real de correo.** No hay servidor de correo configurado en local: todo lo
  verificado es el **contenido** del mensaje, no su entrega. Sigue dependiendo de **D-6**, la
  gestión del buzón de pruebas.
- **El aviso de "Cifras aproximadas" en la aplicación real.** Solo está cubierto por pruebas: los
  gastos de la base de ejemplo son todos en una moneda con tasa disponible, así que no hay forma
  de provocar el caso sin inventar datos. El aviso leve sí se vio en vivo.
- **Producción.** Nada se aplicó en Supabase. Importante: `GET /api/expenses` **cambió de
  contrato**, así que el frontend nuevo no funciona contra el backend viejo. El orden de
  despliegue está documentado en `DESPLIEGUE.md`.
- **Volumen real.** Las mediciones son sobre doce gastos y tres proyectos.

---

## 7. Las cinco decisiones que esto levanta

Están desarrolladas en `DECISIONES_REUNION.md` con sus opciones y lo que cuesta cada respuesta.

| | Pregunta | Qué bloquea |
|---|---|---|
| **D-10** | ¿Fecha de contrato = inicio del proyecto? ¿Ingresos a factura o a cobro? | Cualquier alternativa exige un campo nuevo |
| **D-11** | ¿Se carga el histórico de tasas hacia atrás? | Sin ello, los presupuestos siguen moviéndose |
| **D-12** | ¿Hora del resumen semanal: única o por país? | Por país exige poblar un dato que nadie llena |
| **D-13** | ¿Puede aprobar un consultor con delegación vigente? | La delegación hoy solo sirve entre PM |
| **D-14** | ¿Con qué fecha se valora el presupuesto frente al gasto? | El % de ejecución mezcla criterios |

Ninguna salió de una pregunta teórica: **las cinco aparecieron al implementar y toparse con el
límite de lo que desarrollo puede decidir.**

---

_Detalle técnico y evidencia archivo:línea en `PENDIENTES.md` §6.1. Procedimiento de despliegue
en `DESPLIEGUE.md`._
