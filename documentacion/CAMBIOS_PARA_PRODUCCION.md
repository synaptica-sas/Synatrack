# Qué trae la nueva versión de Synatrack

**Resumen para dirección — 30 de septiembre de 2026**

Este documento describe todo lo que la rama `dev` aporta frente a la versión que hoy está en
producción, y dice con franqueza qué falta antes de poder desplegarla.

La versión en producción es del **2 de septiembre**. Desde entonces el trabajo acumulado es de
**69 cambios** sobre 448 archivos, repartidos entre tres personas:

| Persona | Cambios | Aportación principal |
|---|---|---|
| Juan Mahecha | 53 | Seguridad, corrección de cifras, fiabilidad, rediseño, pruebas |
| Wilson Córdoba | 12 | Timesheet, cronómetro, informes de horas, tres fallos de seguridad y la tabla de decisiones de negocio |
| Juan Espinosa | 4 | Unificación de Gastos e Ingresos, y el desfase de base de datos |

---

## 1. Lo que estaba mal y ahora está bien

Esta es la parte más importante. No son mejoras cosméticas: son datos que se mostraban mal o
información que se estaba filtrando.

### Fugas de información entre personas

- **Cualquier consultor podía ver lo que cobran sus compañeros.** Varios listados devolvían la
  tarifa por hora y el costo mensual de toda la plantilla a quien preguntara. Se cerró en tres
  sitios distintos; el último lo encontró Wilson al construir el timesheet.
- **El rastro de quién aprobaba una solicitud era falsificable.** El sistema se creía el nombre
  que le enviaba el navegador en lugar de mirar quién había iniciado sesión. Ahora la identidad
  sale siempre del token de sesión.
- **Un consultor podía registrar horas a nombre de otro.** Corregido y cubierto con pruebas.
- **La API devolvía detalles internos al fallar**: rutas del servidor y nombres de tablas
  viajaban al navegador en cualquier error. Ahora el detalle queda solo en el registro interno.
- Se añadieron cabeceras de seguridad y un límite de peticiones, que no existían.

### Cifras que no cuadraban

- **La rentabilidad se calculaba de tres maneras distintas** según la pantalla, y el umbral de
  margen estaba fijado a 15 % en el código aunque cada proyecto tuviera el suyo. Ahora hay un
  solo cálculo y se respeta el umbral de cada proyecto. **Consecuencia visible: algunos
  proyectos van a cambiar de color en el semáforo.** Es la corrección, no un error.
- **El portafolio contaba dos veces la misma plata**: sumaba las horas ya ejecutadas como gasto
  y otra vez como proyección.
- **El tablero mostraba cifras equivocadas al abrirlo**, y solo se arreglaban si el usuario
  cambiaba de moneda y volvía.
- **Los importes en otra moneda se sumaban sin convertir.** Si faltaba la tasa de cambio, un
  monto en pesos se sumaba a un total en dólares como si fuera dólares, y el resultado se
  etiquetaba con la moneda equivocada. Nadie se enteraba. Ahora la aplicación avisa en pantalla
  con el rótulo **"Cifras aproximadas"**, dice qué tasa falta y ofrece un atajo para cargarla.

### Campos que el sistema leía pero nadie podía rellenar

Apareció **cinco veces** el mismo patrón: el sistema usaba un dato para decidir algo, pero no
existía ningún formulario para configurarlo, así que siempre valía lo mismo.

El caso con más impacto: **no se podía asignar el Project Manager de un proyecto**, y sin eso
**el flujo de aprobación de horas extra por parte del PM simplemente no funcionaba** (ver también
"Las horas extra ya no pasan por Nómina", más abajo). También se
habilitaron los umbrales de margen y alerta de presupuesto, y el documento de identidad del
consultor.

### Tareas automáticas que llevaban meses sin ejecutarse

**La sincronización diaria de tasas de cambio apuntaba a una dirección que no existe.** Llevaba
meses fallando en silencio: las tasas no se actualizaban y nadie lo sabía. Se corrigió, y además
se añadió un registro permanente de cada ejecución, de modo que ahora **se puede preguntar a la
aplicación si sus tareas automáticas están vivas** sin depender de que alguien revise el panel
del proveedor. Distingue tres situaciones que antes se confundían: nunca se ejecutó, se ejecutó y
falló, o se ejecutó bien hace demasiado tiempo.

### Desfase entre el código y la base de datos

El esquema de la base y el historial de cambios llevaban tiempo divergiendo, lo que hacía
arriesgado cualquier despliegue. Juan Espinosa levantó el problema y lo corrigió; después se
completó lo que faltaba y se hizo el arreglo repetible sin riesgo.

---

## 2. Lo que se puede hacer ahora y antes no

### Registro de horas (Wilson Córdoba)

- **Timesheet semanal**: una rejilla para cargar las horas de toda la semana de una vez.
- **Cronómetro**: registro en vivo, con precisión de segundos, y la posibilidad de registrar a
  nombre de otro consultor cuando el rol lo permite.
- **Informes de horas**: gráfica semanal, totales y exportación, con aviso aparte de las horas
  registradas en fin de semana.

### Gastos e Ingresos unificados (Juan Espinosa)

Eran dos tablas y dos pantallas separadas. Ahora son **un solo panel sobre una sola tabla**, que
era un requerimiento del cliente. Esto simplifica el reporte financiero y elimina una fuente de
inconsistencias.

### Decisiones de negocio documentadas (Wilson Córdoba)

Al construir el timesheet y el cronómetro aparecieron preguntas que no puede responder un
desarrollador, y en vez de resolverlas por su cuenta las dejó planteadas con sus opciones. Ese
trabajo es la base del documento `DECISIONES_REUNION.md`.

### Las horas extra ya no pasan por Nómina

Hasta ahora una solicitud de horas extra necesitaba **dos vistos buenos**: primero el del Director
de Proyecto y después el de Nómina. Eran dos bandejas, dos personas y dos esperas para pagar unas
horas que ya se habían trabajado.

**A partir de esta versión basta con la aprobación del Director de Proyecto.** El razonamiento es
que es él quien conoce el estado de salud de su proyecto: si aprueba las horas, es porque el
proyecto puede asumirlas. Nómina **desembolsa, no decide**.

Qué cambia en la práctica:

- El Director de Proyecto aprueba y las horas quedan aprobadas en ese mismo momento.
- Nómina deja de tener bandeja de aprobación. Sigue viendo, como siempre, el **cierre consolidado
  del mes** con todo lo aprobado y su importe, que es lo que necesita para pagar, y sigue
  recibiendo el aviso por correo cada vez que hay un importe nuevo aprobado.
- Nómina ya no puede aprobar ni rechazar. Si aparece un problema de caja, se resuelve fuera del
  sistema.
- **Las solicitudes que estaban esperando a Nómina quedan aprobadas automáticamente** al
  desplegar. Ya tenían el visto bueno del Director de Proyecto, que con la regla nueva es el
  único necesario. El cambio queda registrado en la bitácora, explicado, para que nadie se
  pregunte por qué cambiaron solas de estado.

En pantalla desaparece la segunda bandeja y las etiquetas "Nivel 1" y "Nivel 2", que ya no
significan nada cuando solo hay un nivel.

### Auditoría completa

Antes solo quedaba rastro de una parte de las operaciones. Ahora también de horas, horas extra,
gastos, ingresos, consultores y usuarios, con el antes y el después de cada cambio.

---

## 3. Rendimiento

Los listados que crecen con el tiempo —horas, horas extra, ingresos y gastos— devolvían **todo el
histórico** en cada consulta. Con pocos datos no se nota; con un año de operación se vuelve el
cuello de botella.

Ahora se sirven por páginas. Se cuidó especialmente que **ninguna pantalla pase a mostrar un
subconjunto sin avisar**: las que necesitan el total completo —la rejilla semanal, los informes,
las colas de aprobación, las exportaciones— lo siguen pidiendo entero, y las demás muestran el
paginador con el número total a la vista.

---

## 4. Aspecto

La aplicación se unificó bajo un sistema de diseño. **La identidad de Synaptica no cambia**: los
colores corporativos son los mismos. Lo que se retiró fue una segunda paleta que se había colado
por copiar y pegar código de terceros y convivía con la nuestra.

En números: los estilos escritos a mano dentro del código bajaron de **1.162 a 340**, y los
colores incrustados de **575 a 100**.

Efectos prácticos: el modo oscuro funciona en pantallas donde antes dejaba texto ilegible, se
corrigieron varios textos que no alcanzaban el contraste mínimo de accesibilidad, y varias
pantallas que no se podían usar en móvil ahora se adaptan.

**Quedan dos pantallas sin unificar**: Actividades y la estructura general de la aplicación.
Actividades está deliberadamente en pausa (ver decisión D-8 del documento de decisiones).

---

## 5. Calidad y mantenimiento

| | Antes | Ahora |
|---|---|---|
| Pruebas automáticas | 277 | **569** |

Más importante que el número: **las pruebas se verificaron rompiendo el código a propósito** para
comprobar que efectivamente detectan los fallos, en lugar de dar por bueno que pasan.

También se corrigió un riesgo real: dos grupos de pruebas escribían contra la base de datos de
trabajo del desarrollador en lugar de una base dedicada.

Se documentó el proyecto para que cualquiera pueda retomarlo: guía de despliegue ensayada paso a
paso, mapa de la aplicación, lista viva de pendientes y convenciones de diseño.

---

## 6. Qué falta antes de desplegar

**Antes que nada: hay un problema de seguridad en la base de producción.** Se encontró el 5 de
octubre. La base de datos publica una interfaz automática que hoy **no tiene ninguna
restricción**: cualquiera que tenga la clave pública de la aplicación —que por diseño no es
secreta— puede leer o modificar sueldos, tarifas, documentos de identidad y márgenes sin pasar
por la aplicación ni por ningún control. Se corrige en minutos y no afecta al funcionamiento,
pero **debe hacerse antes del despliegue**.


Con franqueza, porque conviene saberlo antes y no después:

1. **La base de datos de producción hay que rehacerla.** La que está funcionando quedó atada a un
   repositorio distinto y no recibiría los cambios de esquema. El procedimiento está ensayado y
   documentado, y lo que hay en producción son datos de prueba, pero **es el paso que más
   atención requiere**.
2. **Hay que cargar las tasas de cambio inmediatamente después.** Con la base recién creada, la
   aplicación va a mostrar el aviso de "Cifras aproximadas" en casi todas las pantallas hasta que
   se carguen. Es el comportamiento correcto, pero si nadie lo sabe se va a reportar como un
   fallo.
3. **Falta una revisión visual de la paginación en el navegador.** Está verificada por pruebas
   automáticas y contra la API real, pero no se pudo abrir en un navegador para confirmar el
   comportamiento en pantalla. Afecta a dos pantallas de uso diario.
4. **Hay nueve decisiones de negocio pendientes** que el equipo de desarrollo no puede tomar. Una
   de ellas, la D-7, produce hoy una contradicción visible: un mismo proyecto puede aparecer con
   la celda en rojo y su semáforo en ámbar, porque la pantalla y el cálculo usan criterios
   distintos. Están detalladas en `DECISIONES_REUNION.md`.

---

## 7. Un aviso sobre el estado actual de las ramas

**La rama `main` ya fue actualizada** con 67 de estos 69 cambios, por alguien del equipo, sin que
mediara la revisión final. Los dos cambios que faltan son el aviso de cifras aproximadas en
pantalla y la paginación.

**Producción sigue ejecutando la versión anterior** —se verificó— así que no hay nada roto en este
momento. Pero conviene saber que la rama y lo que está desplegado ya no coinciden, y que un
despliegue automático desde `main` publicaría código que espera cambios de base de datos que
todavía no se han aplicado.

---

_Detalle técnico en `DESPLIEGUE.md` (procedimiento), `PENDIENTES.md` (lista viva) y
`DECISIONES_REUNION.md` (las nueve decisiones)._
