# Preguntas para Greisy

**Actualizado: 6 de octubre de 2026**

Estas son las preguntas que el equipo de desarrollo no puede responder por su cuenta: son de
negocio, no técnicas. Todas salieron de construir lo que se pidió y toparse con un punto donde
elegir mal cambia los números que verás en pantalla.

Cada una trae lo que hay hoy, las opciones reales y una recomendación del equipo. **La
recomendación es una propuesta para que la conversación arranque desde algo concreto, no una
conclusión.**

Al final de cada punto hay una línea para anotar la respuesta.

---

## Resumen

| | Pregunta | Urgencia |
|---|---|---|
| **1** | ¿Se va a usar el módulo de Actividades? | **Alta** — bloquea trabajo ya estimado |
| **2** | ¿Qué fecha fija el tipo de cambio de un contrato? ¿Y la de un ingreso? | **Alta** — cualquier cambio exige un campo nuevo |
| **3** | ¿Se carga el histórico de tasas de cambio hacia atrás? | Media |
| **4** | ¿Con qué fecha se compara el gasto contra el presupuesto? | Media |
| **5** | ¿Qué gastos cubre la categoría "Servicios"? | Baja — pero es de respuesta inmediata |

---

## 1. ¿Se va a usar el módulo de Actividades?

**Qué hay hoy.** El cronómetro y el registro de horas permiten enlazar cada apunte a una
actividad, para poder comparar después las horas estimadas con las reales. Pero **casi no hay
actividades creadas**: en la base de ejemplo hay dos para tres proyectos. En la práctica el
desplegable de tarea aparece casi siempre con una sola opción, "Sin tarea", y **da la impresión
de estar roto**.

**Por qué urge.** La pantalla de Actividades es una de las más grandes del sistema y está
pendiente de unificar con el nuevo diseño. Ese trabajo son unos **281 elementos**, el bloque más
grande que queda. **Si el módulo se retira, ese trabajo desaparece con él.** Está parado
esperando esta respuesta.

Mientras tanto la pantalla se ocultó: hoy solo la ve un administrador.

**Opciones.**

1. **Se empieza a usar.** Hay que crear actividades en los proyectos reales para que el selector
   tenga sentido, y se unifica la pantalla con el resto.
2. **Se retira.** Se quita el selector de tarea del cronómetro y del registro de horas, y la
   pantalla se elimina.
3. **Se deja como está**, oculta e indefinidamente.

**La pregunta de fondo.** ¿La PMO va a comparar horas estimadas contra reales **a nivel de
tarea**? Si la respuesta es sí, hay que comprometerse a crear esas tareas. Si es no, mejor
retirarlo y recuperar el tiempo.

**Respuesta:** _______________________________________________

---

## 2. ¿Qué fecha fija el tipo de cambio de un contrato? ¿Y la de un ingreso?

**Qué se corrigió.** Hasta hace poco, todo se convertía de moneda con **la tasa del día en que se
consultaba**. Eso significaba que el presupuesto de un contrato firmado hace meses **cambiaba
solo cada mañana**. Ya está arreglado: cada importe se convierte con la tasa de su fecha.

**Pero hubo que elegir qué fecha le toca a cada cosa**, y dos de esas elecciones son
provisionales porque el sistema no guarda nada mejor:

| | Hoy se valora a | Pregunta |
|---|---|---|
| Presupuesto y precio de venta | La fecha de **inicio del proyecto** | ¿Es esa la fecha del contrato, o se firma antes? |
| Ingresos | La fecha de **factura** | ¿O debería ser la de **cobro**? |

**Por qué importa.** Si un contrato se firma en marzo y el proyecto arranca en junio, hoy se usa
la tasa de junio para un valor que se pactó en marzo. Y si lo que cuenta contablemente es el
cobro y no la factura, los ingresos están valorados con la fecha equivocada.

**Lo que cuesta cada respuesta.** Confirmar lo que hay no cuesta nada. Cualquiera de las dos
alternativas exige **guardar un dato nuevo** —la fecha de firma, o la fecha de cobro— que hoy no
existe en ninguna parte.

**Recomendación del equipo.** Confirmar lo implementado salvo que contabilidad diga lo contrario.
Si la respuesta es "cobro", **conviene saberlo pronto**: cuantos más ingresos se registren, más
caro resulta rellenar esa fecha hacia atrás.

**Respuesta:** _______________________________________________

---

## 3. ¿Se carga el histórico de tasas de cambio hacia atrás?

**Qué pasa.** El sistema ya sabe convertir con la tasa de la fecha de cada movimiento, pero
**solo tiene tasas registradas de un día**. Para cualquier fecha anterior no hay dato, así que
usa la de hoy.

**Lo bueno:** eso ya no pasa en silencio, la aplicación lo avisa en pantalla.
**Lo malo:** mientras no haya histórico, el presupuesto de un proyecto de mayo sigue moviéndose
cada día, que es justo lo que se quería evitar.

**Opciones.**

1. **Cargar la serie histórica completa**, a mano o pidiéndosela al proveedor de tasas. Cuánto
   hacia atrás depende de desde cuándo hay contratos vivos.
2. **No cargarla**, y asumir que los contratos anteriores se revalúan. Sin coste, pero el aviso
   seguirá apareciendo en casi todas las pantallas.
3. **Cargar solo las fechas que hacen falta**: una tasa por cada fecha de inicio de proyecto
   activo.

**Recomendación del equipo.** La 3 como primer paso. Son pocas fechas, resuelve lo que más
molesta —el presupuesto que no para quieto— y no obliga a conseguir una serie completa.

**Respuesta:** _______________________________________________

---

## 4. ¿Con qué fecha se compara el gasto contra el presupuesto?

**Qué pasa.** El "% de ejecución presupuestal" divide dos cifras que se convierten con criterios
distintos, y **cada una es correcta por separado**: los gastos a la tasa del día en que
ocurrieron, y el presupuesto a la de cuando se contrató. El problema es que **su cociente no
corresponde a ninguna fecha**.

**Opciones.**

1. **Comparar todo a la fecha del contrato.** El presupuesto es el ancla. Responde: *"¿cuánto
   llevo gastado, medido como se pactó?"*
2. **Comparar todo a la tasa de hoy.** Responde: *"¿cuánto vale hoy lo gastado frente a lo
   presupuestado?"*, pero el número vuelve a moverse solo.

**Recomendación del equipo.** La 1: si el presupuesto se pactó en una fecha, medir contra él
tiene sentido en esa misma fecha.

**Nota aparte, que no es una decisión.** Al revisar esto se encontró un error: el indicador
"Presupuesto (proyectos filtrados)" **suma presupuestos de monedas distintas sin convertirlos**.
Hoy muestra una suma de pesos rotulada como dólares. Eso hay que arreglarlo decidas lo que
decidas; solo hace falta saber con qué fecha convertir.

**Respuesta:** _______________________________________________

---

## 5. ¿Qué gastos cubre la categoría "Servicios"?

**Qué pasa.** Existe una categoría de gasto llamada "Servicios" que nadie ha definido, así que
cada persona puede estar clasificando cosas distintas bajo el mismo nombre. Eso hace que los
informes por categoría no signifiquen lo mismo para todos.

Las categorías ya **se pueden editar desde la aplicación**, sin que desarrollo intervenga: se
pueden renombrar, añadir o retirar.

**Lo que hace falta.** Una frase que diga qué entra en "Servicios" y qué no. Si resulta que mezcla
cosas que deberían ir separadas, también se puede partir en varias.

**Respuesta:** _______________________________________________

---

## Para el acta

| | Pregunta | Acordado | Fecha |
|---|---|---|---|
| 1 | Módulo de Actividades | | |
| 2 | Fecha del tipo de cambio | | |
| 3 | Histórico de tasas | | |
| 4 | Gasto contra presupuesto | | |
| 5 | Categoría "Servicios" | | |

---

_El detalle técnico de cada punto está en `DECISIONES_REUNION.md`, donde figuran como D-8, D-10,
D-11, D-14 y la parte abierta de R-025._
