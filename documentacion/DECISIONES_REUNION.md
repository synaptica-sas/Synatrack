# Decisiones pendientes de Synatrack

**Para resolver en reunión.** Son nueve decisiones que el equipo de desarrollo no puede tomar
por su cuenta: o son regla de negocio, o política de la empresa, o requieren confirmar algo que
no está en el código.

Cada una trae los datos ya verificados contra el código (última verificación: **30/09/2026**), las
opciones reales, y una recomendación del equipo de desarrollo. **La recomendación es una
propuesta, no una conclusión**: está para que la discusión arranque desde algo concreto, no para
cerrarla.

Al final de cada punto hay una línea **Decisión:** para anotar lo acordado en la misma reunión.

---

## Estado al 30 de septiembre

**Ninguna de las nueve se ha resuelto todavía.** El trabajo técnico ha seguido avanzando
alrededor de ellas, y eso cambia el coste de dos:

- **D-8 sigue bloqueando trabajo real.** La pantalla de Actividades es la última grande sin
  unificar bajo el sistema de diseño, y no se toca a propósito: si el módulo se retira, ese
  trabajo se tira. Es la decisión que más tiempo ahorra o desperdicia según cómo se responda.
- **D-7 ya no es solo teórica.** La contradicción entre los dos criterios se ve hoy en pantalla,
  y ahora además convive con el resto de la pantalla de Portafolio ya rediseñada, así que
  destaca más que antes.

Las otras siete siguen igual de abiertas y con el mismo coste que tenían.

---

## Cómo usar este documento

Las nueve no tienen la misma urgencia. Si la reunión es corta, este es el orden:

| Prioridad | Decisiones | Por qué primero |
|---|---|---|
| **Resolver hoy** | D-1, D-7, D-8 | D-1 es una pregunta de sí o no con consecuencia inmediata; D-7 ya se está viendo mal en pantalla; D-8 decide si se hace o se descarta trabajo ya presupuestado |
| **Resolver esta semana** | D-3, D-9 | Afectan a lo que los usuarios ven y a lo que se factura |
| **Puede esperar** | D-2, D-4, D-5 | Implican cambios de modelo o de diseño; conviene decidirlas bien, no rápido |
| **No es una decisión** | D-6 | Hace falta una credencial, no una respuesta |

---

## D-1 · ¿El dominio `synaptica.cc` es nuestro?

**Qué pasa.** El remitente de todos los correos que envía la aplicación es
`noreply@synaptica.cc`, mientras el resto del proyecto —cuentas, usuarios, documentación— usa
`synaptica.co`. Está en dos sitios: `backend/src/utils/notifications.ts:10` como valor por
defecto y `backend/.env.example:48`.

**Por qué importa.** Si `synaptica.cc` no es un dominio de la empresa, cada correo que sale
—avisos de aprobación de horas, alertas de presupuesto, notificaciones de horas extra— lleva un
remitente que no nos pertenece. Los servidores de correo lo tratan como suplantación: va a spam,
o directamente se rechaza. Nadie se entera de que los avisos no llegan.

**Opciones.**

1. Es nuestro y está bien. No se toca nada.
2. Es un error de tipeo por `synaptica.co`. Se corrige en los dos sitios.
3. Es de un tercero. Hay que registrar un dominio propio o usar `synaptica.co`.

**Recomendación del equipo.** Es la decisión más barata de las nueve y la de consecuencia más
inmediata. Basta con que alguien confirme si el dominio está registrado a nombre de Synaptica.
Si la respuesta es «no» o «no sé», la opción 2 es la segura.

**Decisión:** es synaptica.co siempre

---

## D-2 · ¿El umbral de margen por defecto debe ser 15 %?

**Qué pasa.** Cuando un proyecto no tiene `marginThreshold` configurado, el sistema aplica 15 %
(`backend/src/utils/financial.ts:124`). Ese número no lo eligió nadie: era el comportamiento que
ya existía y se dejó documentado como valor por defecto al unificar el cálculo de rentabilidad.

**Por qué importa.** Ese umbral decide cuándo un proyecto se marca como de margen bajo y dispara
una alerta. Si 15 % no es el criterio real del negocio, todos los proyectos sin configurar están
alertando —o dejando de alertar— con el número equivocado.

**Opciones.**

1. **Confirmar 15 %** como valor por defecto de la empresa. Cero trabajo.
2. **Cambiarlo** a otro número. Trabajo mínimo: es una constante.
3. **Quitar el valor por defecto** y obligar a configurarlo proyecto por proyecto. Es lo más
   correcto conceptualmente, pero exige poblar el campo en todos los proyectos existentes y
   decidir qué hacer mientras tanto con los que no lo tengan.

**Recomendación del equipo.** La 1 o la 2, según lo que diga finanzas. La 3 suena mejor de lo que
es: mientras el campo esté vacío en la mayoría de proyectos, el sistema se queda sin criterio y
hay que inventar uno igualmente.

**Decisión:** en la info del proyecto se configure el margen del proyecto ya que es dependiente a cada uno (normalmente es 30 y 15 ya es critico)

---

## D-3 · ¿Un VIEWER debe ver los movimientos financieros de todos los proyectos?

**Qué pasa.** `GET /api/financial-entries` autoriza a ADMIN, PM, FINANCE y VIEWER
(`financial-entries.routes.ts:30`), pero **no filtra las filas por rol**: quien entra ve todos los
ingresos y gastos de todos los proyectos. El resto de módulos —horas, horas extra, actividades—
sí recortan lo que devuelven según quién pregunta.

**Por qué importa.** Es la misma clase de fuga que ya se cerró en horas y en registros de tiempo,
donde un consultor podía leer las tarifas de sus compañeros. Aquí no se ha tocado porque **puede
ser intencional**: un VIEWER podría ser justamente un perfil de supervisión que debe verlo todo.

**Opciones.**

1. **Es intencional.** Se documenta y se deja como está.
2. **No lo es.** Se limita el VIEWER a los proyectos que tenga asignados, como el resto de módulos.
3. **Depende de quién.** Hay más de un tipo de VIEWER y hace falta distinguirlos.

**Recomendación del equipo.** Hace falta saber **quién tiene rol VIEWER hoy y para qué**. Si son
perfiles de dirección, la opción 1. Si es un rol que se reparte con facilidad, la 2, porque son
datos financieros de todos los proyectos.

**Decisión:** StandBy
---

## D-4 · ¿Los ingresos se categorizan?

**Qué pasa.** El campo `category` de `FinancialEntry` solo se usa en gastos. En ingresos queda
nulo, y el esquema no lo impide: el comentario del modelo dice literalmente «solo aplica a
EXPENSE; null en REVENUE» (`schema.prisma:302`), pero es una convención, no una regla.

**Por qué importa.** Si el negocio necesita categorizar ingresos —por tipo de servicio, por línea
de negocio, por lo que sea— hay que decidirlo antes de que se acumulen datos, porque después hay
que rellenar hacia atrás. Si no se necesita, conviene que el esquema lo impida en vez de confiar
en que nadie lo rellene por error.

**Opciones.**

1. **No se categorizan.** Se refuerza la regla para que el sistema lo garantice.
2. **Sí se categorizan**, con una lista de categorías distinta a la de gastos. Es cambio de modelo
   y de formularios.

**Recomendación del equipo.** Preguntar a finanzas si hoy reportan ingresos por algún criterio que
la aplicación no esté guardando. Si la respuesta es que no, la opción 1.

**Decisión:** Si, dejar 2 campos de categoria de ingresos genericos con posibilidad de luego editarlos

---

## D-5 · ¿La jornada laboral se configura por país, por consultor, o ambos?

**Qué pasa.** Existe un modelo `CapacityConfig` con `hoursPerDay` (8 por defecto) y
`workDaysPerWeek` (5 por defecto), y el cálculo de capacidad lo lee en cinco sitios distintos.
Pero **no hay ningún formulario ni endpoint que lo cree o lo edite**, así que la fila siempre está
vacía y **toda la capacidad del sistema se calcula con 8 h × 5 días para todo el mundo**, sin
importar el país ni la jornada real de cada consultor.

**Por qué importa.** La matriz de capacidad y los porcentajes de ocupación se están calculando
sobre una jornada que puede no ser la real. En un equipo repartido entre países con jornadas
distintas, el dato es sencillamente incorrecto.

**Por qué es una decisión y no una tarea.** El modelo admite configurarlo por país **o** por
consultor. Hacer la pantalla exige saber cuál de los dos, o si hacen falta los dos con una
precedencia (el consultor manda sobre su país, por ejemplo). Es diseño, no implementación.

**Opciones.**

1. **Por país.** Más simple. Una configuración por cada país donde opera Synaptica.
2. **Por consultor.** Más flexible, más trabajo de mantenimiento para quien administre.
3. **Ambos, con precedencia.** Un valor por país, y una excepción por consultor cuando haga falta.

**Recomendación del equipo.** La 3, porque es la que el modelo ya soporta y cubre los dos casos
sin rehacer nada después. Pero si en la práctica todos los consultores de un país tienen la misma
jornada, la 1 ahorra una pantalla entera.

**Decisión:** Si, tanto por pais como por consultor, en consultor por defecto ponle en colombia 8.5 y en ecuador 8

---

## D-6 · Credenciales SMTP de prueba

**Esto no es una decisión, es algo que hace falta conseguir.**

**Qué pasa.** El envío de correo está configurado con `ciphers: "SSLv3"` y
`rejectUnauthorized: false` (`backend/src/utils/notifications.ts:29-30`). El primero fuerza un
protocolo obsoleto; el segundo desactiva la validación del certificado del servidor, lo que anula
buena parte de la protección de TLS. El comentario en el código dice que es por compatibilidad con
Office 365 y para evitar errores de certificado en desarrollo.

**Por qué no se ha arreglado.** Porque no hay forma de comprobar que el arreglo no rompe el envío.
Cambiarlo a ciegas en producción significa arriesgarse a que dejen de salir todos los avisos sin
que nadie se entere.

**Lo que hace falta.** Un buzón de pruebas —o las credenciales SMTP reales en un entorno que no
sea producción— para verificar el cambio antes de aplicarlo.

**Decisión / responsable de conseguirlo:** noreply@synaptica.co y luego nos dices como conseguirlo para activarlo desde nuestro entraID

---

## D-7 · ¿Cuáles son los umbrales correctos de CPI, SPI y uso de presupuesto?

**Esta ya se está viendo mal en pantalla.**

**Qué pasa.** Hay dos criterios distintos para lo mismo, y se contradicen:

| | Pinta la celda en Portafolio | Calcula el semáforo de salud |
|---|---|---|
| Dónde | `PortfolioTab.tsx` | `backend/src/utils/health.ts` |
| Rojo si | CPI < **0,85** | CPI < **0,75** |
| Ámbar si | CPI < **1,00** | CPI < **0,90** |

**Consecuencia concreta.** Un proyecto con CPI 0,80 sale con **la celda en rojo y el semáforo de
su propia fila en ámbar**. Con CPI 0,95, la celda va en ámbar y la fila en verde. La misma
pantalla se contradice a sí misma, y quien la lee no sabe cuál de los dos colores creer.

**Por qué es decisión de negocio.** Unificarlos es trivial técnicamente. Lo que nadie en
desarrollo puede decidir es **cuál de los dos juegos de números es el correcto**, porque define
cuándo se considera que un proyecto va mal.

**Opciones.**

1. **Manda el criterio del backend** (0,75 / 0,90). Más tolerante: menos proyectos en rojo.
2. **Manda el criterio de la pantalla** (0,85 / 1,00). Más exigente: cualquier proyecto que no
   vaya perfecto aparece marcado.
3. **Un tercer juego de números** que defina la PMO.

**Recomendación del equipo.** Decidir el número primero y dónde vive después. Una vez acordado, el
arreglo es unificar ambos en un solo sitio para que no vuelvan a separarse.

**Decisión:** son configuracion general, debe haber una pantalla para hacer la configuracion para que no esten hardcodeados
---

## D-8 · ¿Se va a usar el módulo de Actividades?

**Esta decide si se hace o se descarta trabajo ya identificado.**

**Qué pasa.** El nuevo cronómetro y el timesheet permiten enlazar cada registro de tiempo a una
actividad, para poder comparar horas estimadas contra horas reales. Pero el módulo está
prácticamente sin usar: **en la base de datos de demostración hay 2 actividades para 4
proyectos**. En la práctica, el desplegable de tarea aparece casi siempre con una sola opción,
«Sin tarea», y da la impresión de estar roto.

**Por qué importa ahora.** La pantalla de Actividades es una de las más grandes del sistema. Está
pendiente de migrar al nuevo sistema de diseño, y ese trabajo son unos **281 elementos**, de lo
que queda el bloque más grande con diferencia. **Si el módulo se retira, ese trabajo desaparece
con él.** Por eso está parado a la espera de esta decisión.

**Opciones.**

1. **Se empieza a usar.** Hay que crear actividades en los proyectos reales para que el selector
   tenga sentido, y se migra la pantalla.
2. **Se retira.** Se quita el selector de tarea del cronómetro y del timesheet, y la pantalla de
   Actividades se elimina.
3. **Se deja como está.** El selector sigue mostrando «Sin tarea» y la pantalla queda sin migrar,
   visualmente distinta al resto.

**Recomendación del equipo.** La 3 es la peor de las tres: deja una pantalla a medias y un
desplegable que parece averiado. Entre la 1 y la 2, la pregunta real es si la PMO va a comparar
horas estimadas contra reales a nivel de tarea. Si la respuesta es sí, la 1 —pero hay que
comprometerse a poblar las actividades—. Si es no, la 2 y se recupera el tiempo.

**Decisión:** StandBy (Oculta la pagina por ahora, solo el admin puede verla)

---

## D-9 · ¿Las horas de sábado y domingo cuentan en el informe semanal?

**Qué pasa.** El informe semanal de horas cubre de lunes a viernes. Si hay horas registradas en
fin de semana, avisa aparte en vez de ocultarlas, para que no se pierdan. Pero el modelo de
consultor tiene un campo `allowWeekendWork` (`schema.prisma:213`), o sea que trabajar en fin de
semana **está contemplado** en el sistema.

**Por qué importa.** Si esas horas son facturables o cuentan para la ocupación del consultor,
dejarlas fuera del total del informe significa que el informe no cuadra con la realidad. Si son
una excepción que hay que vigilar, el tratamiento actual es el correcto.

**Opciones.**

1. **Entran en los totales**, como cualquier otro día.
2. **Siguen como excepción**: fuera del total, pero señaladas. Es el comportamiento actual.
3. **Depende del consultor**: entran si tiene `allowWeekendWork` activado, se señalan si no.

**Recomendación del equipo.** La 3 es la que da sentido al campo que ya existe: para quien tiene
el fin de semana autorizado es jornada normal, y para quien no, es una excepción que conviene que
alguien mire. Depende de cómo se facturen esas horas.

**Decisión:** Si

---

## D-10 · ¿Qué fecha fija el tipo de cambio de un contrato, y cuál la de un ingreso?

> **Se habla con Greisy.** Esta pregunta está también, en lenguaje de negocio, en
> `PREGUNTAS_PARA_GREISY.md`.

*Decisión nueva, surgida el 05/10/2026 al implementar la conversión por fecha.*

**Qué pasa.** Hasta ahora todo se convertía con la tasa de hoy, así que el presupuesto de un
contrato firmado hace meses se reexpresaba cada día y el número cambiaba solo. Ya está
corregido: cada importe se convierte con la tasa de su fecha. Pero **hubo que elegir qué fecha
le toca a cada cosa**, y dos de esas elecciones son provisionales porque el modelo de datos no
ofrece nada mejor.

**Lo que se implementó, en espera de confirmación:**

| | Se valora a | Pregunta |
|---|---|---|
| Presupuesto y precio de venta | La fecha de **inicio del proyecto** | ¿Es esa la fecha del contrato, o se firma antes y habría que guardar la fecha de firma? |
| Ingresos | La fecha de **factura** | ¿O debería ser la de **cobro**? |

**Por qué importa.** Si el contrato se firma en marzo y el proyecto arranca en junio, hoy se
está usando la tasa de junio para un valor pactado en marzo. Y si lo que cuenta contablemente
es el cobro y no la factura, los ingresos están valorados con la fecha equivocada.

**Lo que cuesta cada respuesta.** Confirmar lo implementado no cuesta nada. Cualquiera de las
dos alternativas exige **un campo nuevo** en la base —fecha de firma, o fecha de cobro— con su
formulario, porque hoy ninguno de los dos existe.

**Recomendación del equipo.** Confirmar lo implementado salvo que contabilidad diga lo
contrario. Si la respuesta es "cobro", conviene saberlo pronto: cuantos más ingresos se
registren, más caro es rellenar esa fecha hacia atrás.

**Decisión:** Se debe hablar con greisy
---

## D-11 · ¿Hay que cargar el histórico de tasas de cambio hacia atrás?

> **Se habla con Greisy.** Esta pregunta está también, en lenguaje de negocio, en
> `PREGUNTAS_PARA_GREISY.md`.

*Decisión nueva, surgida el 05/10/2026.*

**Qué pasa.** La aplicación ya sabe convertir con la tasa de la fecha de cada movimiento, pero
**el histórico de tasas solo tiene cinco registros**, todos del día en que se creó la base. Para
cualquier fecha anterior no hay tasa, así que el cálculo cae a la de hoy.

**Lo bueno:** eso ya no pasa en silencio. La aplicación lo dice en pantalla con el aviso
*"Valoración a la tasa de hoy"*. **Lo malo:** mientras no haya histórico, el presupuesto de un
proyecto de mayo sigue moviéndose cada día, que es justo lo que se quería evitar.

**Opciones.**

1. **Cargar la serie histórica.** Se puede hacer a mano desde la pantalla de Tasas FX, o pidiendo
   el histórico al proveedor. Cuánto hacia atrás depende de desde cuándo hay contratos vivos.
2. **Asumir que los contratos anteriores se revalúan.** Sin coste, pero el aviso de "Valoración a
   la tasa de hoy" seguirá apareciendo en casi todas las pantallas, y conviene que se sepa por
   qué en vez de que se reporte como un fallo.
3. **Cargar solo las fechas que hacen falta**: una tasa por cada fecha de inicio de proyecto
   activo. Es el mínimo que hace que los presupuestos dejen de moverse.

**Recomendación del equipo.** La 3 como primer paso: son pocas fechas, resuelve lo que más
molesta —el presupuesto que no para quieto— y no obliga a conseguir una serie completa.

**Decisión:** _______________________________________________

---

## D-12 · ¿A qué hora sale el resumen semanal, y la misma para todos los países?

*Decisión nueva, surgida el 06/10/2026 al implementar el resumen semanal de aprobaciones.*

**Qué pasa.** Cada PM recibirá ahora un correo semanal con las horas y horas extra que tiene
esperando su aprobación, en vez de un aviso por cada solicitud. El día y la hora se configuran
desde una pantalla, con un valor inicial de **lunes a las 08:00 de Colombia**.

**El problema.** Esa hora se guarda en horario universal (UTC). Para Colombia, Perú y Ecuador
es exacta todo el año. Pero **un PM en Chile, Argentina, México o España lo recibiría a otra
hora**, y en Chile además se movería sola con el horario de verano.

**Las dos preguntas.**

1. ¿Basta con **una sola hora para todos**, o el día y la hora deben configurarse **por país**,
   como ya se hace con los recargos de horas extra y con la jornada laboral?
2. Si es por país: **¿de dónde sale el país del PM?** El campo existe en el modelo de usuario,
   pero es opcional y hoy está prácticamente vacío. La opción por país obliga a poblar un dato
   que nadie llena.

**Recomendación del equipo.** Una sola hora mientras el equipo esté concentrado en Colombia y
Ecuador, que es el caso hoy. Pasar a por país cuesta poco técnicamente, pero no sirve de nada
hasta que alguien se ocupe de registrar el país de cada persona.

**Mientras tanto**, la pantalla muestra la hora en UTC **y su equivalente en Colombia**, para
que nadie la configure a ciegas.

**Decisión (06/10/2026): una sola hora, en horario universal.** No se configura por país. Es lo
que ya estaba implementado, así que no hubo trabajo asociado.

---

## D-13 · ¿Quién puede ser delegado para aprobar horas extra?

*Decisión nueva, surgida el 06/10/2026 al arreglar el bug de delegación.*

**Qué pasaba.** Al delegar la aprobación de horas extra, el sistema fallaba diciendo que el
correo no estaba registrado. La causa: exigía que esa persona ya hubiera **iniciado sesión
alguna vez**. Como el desplegable se rellena con la lista de consultores, y en la práctica casi
ninguno ha entrado, **el formulario ofrecía exactamente las opciones que el sistema rechazaba**.
No era un caso raro: era el caso normal. Ya está corregido.

**Lo que queda, y es más de fondo.** Arreglar eso permite **nombrar** al delegado, pero ese
delegado **sigue sin poder aprobar**. Los endpoints de aprobación solo admiten los roles
Administrador y PM, así que un consultor normal recibe un rechazo antes incluso de que el
sistema mire si tiene una delegación vigente.

Es decir: **hoy la delegación solo funciona de verdad entre personas que ya son PM**, mientras
la pantalla promete delegar en cualquier consultor.

**Por qué no se resolvió sin preguntar.** Se comprobó que basta **una línea** para que funcione.
Pero esa línea amplía quién puede autorizar el pago de horas extra, y eso no es una decisión de
desarrollo.

**Opciones.**

1. **Permitir que un consultor con delegación vigente apruebe.** Es lo que la pantalla ya
   promete. El control sigue existiendo: la delegación tiene fecha de inicio y de fin, y se
   registra quién aprobó.
2. **Restringir la pantalla** a personas que ya son PM. Más conservador, pero entonces la
   delegación sirve de poco: un PM ausente solo puede delegar en otro PM.
3. **Crear un rol de "aprobador delegado"** que se otorgue aparte. Más control, más
   administración.

**Recomendación del equipo.** La 1, que es lo que la pantalla ya ofrece y lo que parece que se
esperaba al pedir la funcionalidad. La delegación ya tiene ventana temporal y deja rastro.

**Mientras tanto**, la pantalla avisa de que el delegado necesita rol PM o Administrador para
poder aprobar, en vez de dejar que lo descubra fallando.

**Decisión (06/10/2026): opción 2, y ya está aplicada** (`852550e`). No se amplían permisos:
únicamente aprueba el PM del proyecto. La delegación se restringe a quien ya es PM —entendido
como figurar de responsable de algún proyecto, no como tener el rol en la cuenta, para no
reintroducir el bug de R-024— y el desplegable dejó de ofrecer consultores que no podrían
aprobar.

---

## D-14 · ¿Con qué fecha se valora el presupuesto al compararlo con el gasto?

> **Se habla con Greisy.** Esta pregunta está también, en lenguaje de negocio, en
> `PREGUNTAS_PARA_GREISY.md`.

*Decisión nueva, surgida el 06/10/2026 al unificar la conversión de Gastos.*

**Qué pasa.** El «% de ejecución presupuestal» divide dos cifras que se convierten con criterios
distintos, y cada uno es correcto por separado: los **gastos** a la tasa del día en que
ocurrieron, y el **presupuesto** a la tasa de cuando se contrató el proyecto. El problema es que
**su cociente no es ninguno de los dos**, así que el porcentaje que se muestra no corresponde a
ninguna fecha concreta.

**Y hay algo peor, que apareció al mirarlo.** El indicador «Presupuesto (proyectos filtrados)»
suma los presupuestos de varios proyectos **sin convertir de moneda**. Hoy, en la base de
ejemplo, rotula *«US$ 660.090.000»*: es una suma de pesos etiquetada como dólares. No es una
aproximación, es un número sin significado.

**Las opciones para el porcentaje.**

1. **Comparar todo a la fecha del contrato.** El presupuesto es el ancla; los gastos se
   reexpresan a esa fecha. Responde «¿cuánto llevo gastado, medido como se pactó?».
2. **Comparar todo a la tasa de hoy.** Responde «¿cuánto vale hoy lo gastado frente a lo
   presupuestado?», pero vuelve a hacer que el número se mueva solo.
3. **Dejarlo como está** y advertir que el porcentaje mezcla criterios.

**Recomendación del equipo.** La 1: si el presupuesto se pactó en una fecha, medir contra él
tiene sentido en esa misma fecha. Lo del indicador que suma monedas distintas **hay que
arreglarlo igualmente**, decida lo que se decida: eso no es una elección, es un defecto, y solo
hace falta saber con qué fecha convertir.

**Decisión:** _______________________________________________

---

## Resumen para acta

**De las catorce, solo cinco necesitan respuesta mañana**: D-10, D-11, D-12, D-13 y D-14. Las
nueve primeras se resolvieron el 05/10 y están implementadas, salvo D-3 y D-8, que quedaron en
espera **por decisión propia** y solo hace falta confirmar si siguen así. D-6 no es una decisión
sino una gestión pendiente: conseguir el buzón de correo.


| # | Acordado | Estado | Fecha |
|---|---|---|---|
| D-1 | Siempre `synaptica.co`. El `.cc` era un error. | **Hecho** (`c360afe`) | 05/10/2026 |
| D-2 | El umbral se configura por proyecto en su ficha. Referencia: 30 % normal, 15 % ya es crítico. | **Hecho** — dos umbrales por proyecto (`marginWarningPct` 30 % y `marginCriticalPct` 15 % por defecto), semáforo, alertas y formulario al día | 05/10/2026 |
| D-3 | En espera. | StandBy | 05/10/2026 |
| D-4 | Sí. Dos categorías genéricas de ingreso, editables después. | **Hecho** — catálogo `FinancialCategory` en la base con pantalla "Categorías Financieras" (Administración, `finance:categories`), migración `20261005210000_categorias_financieras`; arranca con "Servicios de consultoría" y "Otros ingresos", y las de gasto se trasladaron al mismo catálogo | 05/10/2026 |
| D-5 | Por país **y** por consultor. Por defecto Colombia 8,5 h y Ecuador 8 h. | **Hecho** — pantalla "Jornada Laboral" (Administración, `capacity:config`), precedencia consultor → país → general, migración `20261005190000_jornada_configurable`; cierra DEP-41 | 05/10/2026 |
| D-6 | Usar `noreply@synaptica.co`, activado desde el Entra ID propio. Falta que desarrollo explique cómo obtenerlo. | Por hacer | 05/10/2026 |
| D-7 | Son configuración general: hace falta una pantalla para editarlos en vez de tenerlos en el código. | **Hecho** — pantalla "Umbrales de Salud" (`5f62bd4`); de paso se eliminó la contradicción entre Portafolio y el semáforo | 05/10/2026
| D-8 | En espera. Mientras tanto, ocultar la pantalla de Actividades salvo para ADMIN. | StandBy + ocultar | 05/10/2026 |
| D-9 | Sí, sábado y domingo cuentan. | **Hecho** por Wilson (`5953b7f`) | 05/10/2026 |
| D-10 | *Pendiente.* Qué fecha fija el tipo de cambio de contratos e ingresos. | **Para hablar con Greisy** — implementado lo conservador | — |
| D-11 | *Pendiente.* Si se carga el histórico de tasas hacia atrás. | **Para hablar con Greisy** | — |
| D-12 | **Una sola hora, en horario universal.** No se configura por país. | **Resuelto** — ya era lo implementado, sin trabajo asociado | 06/10/2026 |
| D-13 | **No se amplían permisos.** Solo aprueba el PM del proyecto; la delegación se restringe a quien ya es PM. | **Resuelto y aplicado** (`852550e`) | 06/10/2026 |
| D-14 | *Pendiente.* Fecha de valoración del presupuesto frente al gasto. | **Para hablar con Greisy** — el KPI que suma monedas es defecto aparte | — |

---

_La lista viva de pendientes, con el detalle técnico de cada punto, está en_
`documentacion/PENDIENTES.md`.
