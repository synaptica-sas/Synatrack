#Preguntas reformuladas
Las marcadas (R) son mi recomendación. Las del bloque A cambian el modelo de datos o deciden si los casos de prueba pasan.

##A. Bloqueantes

1. Horas diarias: el Excel usa las horas diarias de cada consultor (8 o 4). La app tiene una jornada por país, con Colombia en 8,5 h, y así el caso de Colombia da 54 %, no 57 %. (R) Usar las horas por consultor, con 8 sugerido por defecto.
Rta: las horas diarias son configurables, el gobierno en colombia esta ajustando la jornada laboral muy seguido, de 48 horas semanales ahora ya tenemos 42, y el objetivo es ir a 40, lo mismo puede pasar si empezamos operaciones en otro país donde la jornada es diferente, por eso no hardcodear este valor 

2. Fuente de feriados: (R) una tabla con columna DATE por país como única fuente para capacity, precargada con lo que hoy calcula el código más la hoja Feriados, y editable. Es la única forma de que la alerta de "faltan feriados" tenga sentido. ¿Horas extra también debería usarla más adelante?
Rta: si, correcto, horas extras en feriado tienen un valor diferente en nomina, es importante que este modulo lo tenga en cuenta

3. Feriados locales de Quito: el Excel los aplica a todo Ecuador. ¿Hay consultores de Ecuador fuera de Quito? (R) Replicar el Excel en el MVP.
RTA: tienes razon, debemos tener por lo menos en quito y guayaquil, y tener la opción desde la interfaz para agregar nuevos feriados debido a que en ecuador es muy comun que el gobierno agregue dias de un dia para el otro

4. Ausencias: el Excel no las tiene; la app hoy las resta de la capacidad. (R) Seguir restándolas. Tus casos de prueba no tienen ausencias, así que no cambian.
RTA: ojo para el capacity, calculo de la proyección de ocupacion del empleado no se consideran ausencias, luego haremos un reporte adicional de real vs proyectado en donde comparamos

5. Probables sin proyecto: en el Excel el proyecto es texto libre, así que puede ser una oportunidad que aún no existe en Synatrack. (R) Agregar un estado de proyecto PROSPECT. ¿O se permite asignar sin proyecto?
RTA: si, yo estoy planeando tener un set de proyectos internos para asignar a los empleados en stand by, pero si no tiene asignacion el reporte de capacity debe presentarlo con un % menor al 100 y alertar para que se tomen acciones 

6. Doble conteo con los forecasts: (R) capacity cuenta solo las asignaciones. ¿Finanzas usa los forecasts que se generan solos?
RTA: si, finanzas debe tomar el capacity para su planeación financiera, comercial para traer nuevos negocios y no dejar que baje el capacity

7. Asignaciones en % u horas por mes: el Excel solo maneja horas semanales. (R) Conservar los modos y capturar en h/sem por defecto. ¿Hay asignaciones reales en producción que haya que conservar?
RTA: no, por ahora el sistema aun no esta productivo, no se ha ingresado información

##B. Pantallas y permisos

1. Quién ve capacity: ¿el PM ve a todos o solo a los consultores de sus proyectos? ¿El consultor ve solo su fila? ¿FINANCE entra? ¿El % de un colega es información sensible?
RTA: Debemos tener una configuración de permisos, el capacity debe verlo el PM, Comercial, Admin, Finance, el consultor no ve nada del capacity, y si es informacion confidencial para el consultor.

2. Quién edita: asignaciones, feriados y parámetros. (R) Parámetros y feriados solo ADMIN.
RTA: si, solo el ADMIN

3. Parámetros: (R) umbrales globales y guardados. Mes inicial e "incluir probables" como controles de la vista, sin guardar. ¿Gerencia necesita un informe oficial congelado?
RTA: El mes inicial es de reportería, en el sistema guardamos todo el historial, por defecto debemos mostrar el año completo, pero se debe permitir fecha inicio y fecha fin para filtrar, y si Gerencia necesita un reporte oficial

5. Qué consultores aparecen: ¿activos, externos, los que no tienen país?
6. Fechas de ingreso y salida del consultor: (R) fuera del MVP.
7. Al guardar una sobreasignación: (R) avisar sin bloquear, porque el Excel permite 120 %.
8. Lugar en la UI: (R) nueva sub-pestaña "Mensual" en Capacidad. ¿O reemplaza la vista general?

##C. Pueden esperar

1. Importación: el Excel del repo solo trae datos de ejemplo. ¿Hay una versión con datos reales? El Excel cruza por nombre y no trae email: ¿qué hacemos con los consultores o proyectos que no existen en Synatrack?
RTA: No, no vamos a importar nada, lo cargamos manualmente en la interfaz, lo que vamos a copiar es la logica del reporte

2. Exportación: ¿Excel, PDF o ambos? ¿Una réplica con colores de la hoja Capacity?
RTA: exportamos a ambos formatos

3. Países: (R) guardar el código (EC, CO) y mostrar el nombre.
RTA: El nombre esta bien

4. Despliegue: ¿esto llega solo a dev, o planificamos la salida a producción? Producción sigue en la versión del 2 de septiembre.
RTA: Por ahora estamos en DEV, esto ira a la siguiente version 









4. 
5. 
6. 
7. 